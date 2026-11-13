"""Create a private, project-local LAN CA and serve HTTPS. Never installs trust."""

import argparse, ipaddress, socket, ssl, threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from werkzeug.serving import make_server
from waitress import serve
from app import create_app

BASE = Path(__file__).resolve().parent / ".local" / "tls"


def addresses(extra=()):
    result = {"127.0.0.1"}
    try:
        result.update(
            x[4][0]
            for x in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        )
    except OSError:
        pass
    result.update(str(ipaddress.ip_address(x)) for x in extra)
    return sorted(result)


def certificates(extra=()):
    BASE.mkdir(parents=True, exist_ok=True)
    at = datetime.now(timezone.utc)
    ca_key_path = BASE / "ca.key"
    ca_path = BASE / "classroom-ca.crt"

    def savekey(path, key):
        path.write_bytes(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )

    if not ca_key_path.exists():
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name(
            [
                x509.NameAttribute(
                    NameOID.COMMON_NAME, "Interview Lab Local Classroom CA"
                )
            ]
        )
        ca = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(at - timedelta(minutes=5))
            .not_valid_after(at + timedelta(days=365))
            .add_extension(
                x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()),
                critical=False,
            )
            .add_extension(
                x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
                critical=False,
            )
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    key_encipherment=False,
                    key_cert_sign=True,
                    key_agreement=False,
                    content_commitment=False,
                    data_encipherment=False,
                    crl_sign=True,
                    encipher_only=None,
                    decipher_only=None,
                ),
                critical=True,
            )
            .sign(ca_key, hashes.SHA256())
        )
        savekey(ca_key_path, ca_key)
        ca_path.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password=None)
    ca = x509.load_pem_x509_certificate(ca_path.read_bytes())
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Interview Lab LAN")])
    ips = addresses(extra)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(ca.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(at - timedelta(minutes=5))
        .not_valid_after(min(at + timedelta(days=90), ca.not_valid_after_utc))
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=True,
                key_cert_sign=False,
                key_agreement=False,
                content_commitment=False,
                data_encipherment=False,
                crl_sign=False,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName("localhost")]
                + [x509.IPAddress(ipaddress.ip_address(x)) for x in ips]
            ),
            critical=False,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .sign(ca_key, hashes.SHA256())
    )
    savekey(BASE / "server.key", key)
    (BASE / "server.crt").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return ips


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument(
        "--ip",
        action="append",
        default=[],
        help="Additional LAN IP for the certificate",
    )
    p.add_argument("--cert-only", action="store_true")
    args = p.parse_args()
    ips = certificates(args.ip)
    print(
        "Public trust certificate (copy only this file):",
        BASE / "classroom-ca.crt",
        flush=True,
    )
    for ip in ips:
        print("HTTPS address: https://" + ip + ":5443", flush=True)
    print("No OS certificate trust or firewall settings were changed.", flush=True)
    if not args.cert_only:
        app = create_app()
        threading.Thread(
            target=lambda: serve(app, host="0.0.0.0", port=5200, threads=16),
            daemon=True,
        ).start()
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(BASE / "server.crt", BASE / "server.key")
        print("Local HTTP: http://localhost:5200", flush=True)
        server = make_server("0.0.0.0", 5443, app, threaded=True, ssl_context=ctx)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            server.server_close()

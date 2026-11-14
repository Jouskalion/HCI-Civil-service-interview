

class RuleError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def require(ok, message, status=400):
    if not ok:
        raise RuleError(message, status)


def text(value, limit=5000):
    require(
        isinstance(value, str) and len(value) <= limit, f"请输入不超过 {limit} 字的文本"
    )
    return value.strip()


def integer(value, lo, hi):
    require(type(value) is int and lo <= value <= hi, f"数值须为 {lo} 至 {hi} 的整数")
    return value

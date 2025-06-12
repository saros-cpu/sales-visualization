import pymysql

from config import DB_CONFIG


def get_connection(autocommit=False):
    cfg = dict(DB_CONFIG)
    cfg["autocommit"] = autocommit
    return pymysql.connect(**cfg)


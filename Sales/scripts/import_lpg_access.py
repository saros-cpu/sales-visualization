"""
import_lpg_access.py — 液化气罐区 Access 文件导入脚本

执行方式: 手动或 Windows 计划任务
从固定目录读取 .accdb 文件，解析称重记录写入 lpg_weighing 表
处理完成后将文件移至 backup/ 目录

⚠️ 当前网络未就绪：脚本先行编写部署，待罐区 VPN 连通后测试启用
"""

import os
import sys
import shutil
import argparse
from datetime import datetime, date
from pathlib import Path

import pyodbc
import pymysql
from pymysql.cursors import DictCursor

# 项目路径，确保能导入 config
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
from config import DB_CONFIG as MYSQL_CONFIG

# 目录配置
INCOMING_DIR = PROJECT_ROOT.parent / 'incoming' / 'lpg'
BACKUP_DIR = INCOMING_DIR / 'backup'

# Access 连接字符串（根据实际文件调整）
ACCESS_CONN_STR = (
    r'DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};'
    r'DBQ={filepath};'
)

# 字段映射：Access 列名 → lpg_weighing 列名
# ⚠️ 需根据实际 Access 文件结构调整
FIELD_MAP = {
    '称重单号': 'weigh_serial_no',
    '日期': 'business_date',
    '车号': 'vehicle_no',
    '货名': 'raw_product_name',
    '发货单位': 'sender_name',
    '收货单位': 'receiver_name',
    '毛重': 'gross_weight',
    '皮重': 'tare_weight',
    '净重': 'net_weight',
    '备注': 'remark',
}


def get_access_files():
    """获取待导入的 .accdb 文件列表"""
    path = Path(INCOMING_DIR)
    if not path.exists():
        return []
    return sorted([f for f in path.glob('*.accdb')] + [f for f in path.glob('*.mdb')])


def read_access_file(filepath):
    """读取 Access 文件中的数据"""
    conn_str = ACCESS_CONN_STR.format(filepath=filepath)
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()

    tables = [t.table_name for t in cursor.tables()
              if t.table_type == 'TABLE' and not t.table_name.startswith('MSys')]
    if not tables:
        raise ValueError(f'Access 文件中未找到数据表: {filepath}')

    table_name = tables[0]
    cursor.execute(f'SELECT * FROM [{table_name}]')
    columns = [desc[0] for desc in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    cursor.close()
    conn.close()
    return rows


def import_to_mysql(rows):
    """将 Access 数据写入 lpg_weighing 表"""
    conn = pymysql.connect(**MYSQL_CONFIG)
    cursor = conn.cursor()
    imported = 0
    for row in rows:
        mapped = {}
        for acc_field, lpg_field in FIELD_MAP.items():
            if acc_field in row:
                value = row[acc_field]
                if lpg_field == 'business_date' and isinstance(value, datetime):
                    value = value.date()
                mapped[lpg_field] = value

        if not mapped.get('net_weight'):
            continue

        mapped['weigh_source'] = 'lpg_storage'

        cursor.execute('''
            INSERT INTO lpg_weighing
                (weigh_source, weigh_serial_no, business_date, vehicle_no,
                 raw_product_name, sender_name, receiver_name,
                 gross_weight, tare_weight, net_weight, remark)
            VALUES (%(weigh_source)s, %(weigh_serial_no)s, %(business_date)s,
                    %(vehicle_no)s, %(raw_product_name)s, %(sender_name)s,
                    %(receiver_name)s, %(gross_weight)s, %(tare_weight)s,
                    %(net_weight)s, %(remark)s)
        ''', mapped)
        imported += 1

    conn.commit()
    cursor.close()
    conn.close()
    return imported


def main():
    parser = argparse.ArgumentParser(description='导入液化气罐区 Access 称重数据')
    parser.add_argument('--file', help='指定文件路径（可选，默认扫描 incoming 目录）')
    args = parser.parse_args()

    if args.file:
        files = [Path(args.file)]
    else:
        files = get_access_files()

    if not files:
        print('没有找到待导入的 Access 文件')
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)

    for filepath in files:
        print(f'处理: {filepath.name}')
        try:
            rows = read_access_file(str(filepath))
            count = import_to_mysql(rows)
            shutil.move(str(filepath), os.path.join(BACKUP_DIR, filepath.name))
            print(f'  导入 {count} 条记录完成')
        except Exception as e:
            print(f'  失败: {e}')


if __name__ == '__main__':
    main()

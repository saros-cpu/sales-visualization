from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from pathlib import Path
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import DB_CONFIG  # noqa: E402
from db import get_connection  # noqa: E402


DEFAULT_BACKUP_DIR = PROJECT_ROOT / "backups"


def sql_identifier(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def write_database_dump(path: Path) -> dict:
    conn = get_connection()
    table_count = 0
    row_count = 0
    try:
        cur = conn.cursor()
        cur.execute("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
        tables = [row[0] for row in cur.fetchall()]
        with path.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write("-- Sales Visualization database backup\n")
            fh.write(f"-- Database: {DB_CONFIG['database']}\n")
            fh.write(f"-- Generated at: {datetime.now().isoformat(timespec='seconds')}\n\n")
            fh.write("SET NAMES utf8mb4;\n")
            fh.write("SET FOREIGN_KEY_CHECKS=0;\n\n")
            for table in tables:
                table_count += 1
                quoted = sql_identifier(table)
                cur.execute(f"SHOW CREATE TABLE {quoted}")
                create_sql = cur.fetchone()[1]
                fh.write(f"DROP TABLE IF EXISTS {quoted};\n")
                fh.write(create_sql + ";\n\n")

                cur.execute(f"SELECT * FROM {quoted}")
                columns = [sql_identifier(desc[0]) for desc in cur.description]
                insert_prefix = f"INSERT INTO {quoted} ({', '.join(columns)}) VALUES "
                batch = []
                for row in cur:
                    row_count += 1
                    values = [conn.escape(value) for value in row]
                    batch.append("(" + ", ".join(values) + ")")
                    if len(batch) >= 200:
                        fh.write(insert_prefix + ",\n".join(batch) + ";\n")
                        batch.clear()
                if batch:
                    fh.write(insert_prefix + ",\n".join(batch) + ";\n")
                fh.write("\n")
            fh.write("SET FOREIGN_KEY_CHECKS=1;\n")
    finally:
        conn.close()
    return {"tables": table_count, "rows": row_count}


def add_path_to_zip(zf: zipfile.ZipFile, source: Path, arc_prefix: str) -> int:
    if not source.exists():
        return 0
    count = 0
    if source.is_file():
        zf.write(source, Path(arc_prefix) / source.name)
        return 1
    for path in source.rglob("*"):
        if path.is_file():
            zf.write(path, Path(arc_prefix) / path.relative_to(source))
            count += 1
    return count


def write_file_archive(path: Path) -> dict:
    targets = [
        (PROJECT_ROOT / "README.md", "project"),
        (ROOT / "README.md", "Sales"),
        (PROJECT_ROOT / "OilStation" / "README.md", "OilStation"),
        (PROJECT_ROOT / "OilStation" / "exports", "OilStation/exports"),
        (PROJECT_ROOT / "OilStation" / "cache_snapshots", "OilStation/cache_snapshots"),
        (ROOT / ".runtime", "Sales/.runtime"),
    ]
    file_count = 0
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for source, prefix in targets:
            file_count += add_path_to_zip(zf, source, prefix)
    return {"files": file_count}


def prune_old_backups(backup_dir: Path, keep_days: int) -> int:
    if keep_days <= 0:
        return 0
    cutoff = datetime.now() - timedelta(days=keep_days)
    removed = 0
    for path in backup_dir.glob("sales_visualization_*"):
        if not path.is_file():
            continue
        modified = datetime.fromtimestamp(path.stat().st_mtime)
        if modified < cutoff:
            path.unlink()
            removed += 1
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description="Backup Sales Visualization database and key files")
    parser.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR))
    parser.add_argument("--keep-days", type=int, default=30)
    args = parser.parse_args()

    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    sql_path = backup_dir / f"sales_visualization_db_{stamp}.sql"
    zip_path = backup_dir / f"sales_visualization_files_{stamp}.zip"

    db_result = write_database_dump(sql_path)
    file_result = write_file_archive(zip_path)
    removed = prune_old_backups(backup_dir, args.keep_days)

    print(f"数据库备份: {sql_path}")
    print(f"数据表: {db_result['tables']}，记录: {db_result['rows']}")
    print(f"文件备份: {zip_path}")
    print(f"文件数: {file_result['files']}")
    print(f"清理旧备份: {removed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

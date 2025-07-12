from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from db import get_connection

conn = get_connection()
cur = conn.cursor()
cur.execute("""
    CREATE TABLE IF NOT EXISTS role_module_permissions (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        role VARCHAR(64) NOT NULL,
        module_key VARCHAR(64) NOT NULL,
        granted BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_role_module (role, module_key),
        KEY idx_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
""")
cur.execute("""
    INSERT IGNORE INTO role_module_permissions (role, module_key, granted)
    SELECT 'admin', module_key, TRUE FROM app_modules WHERE is_active = 1
""")
conn.commit()
conn.close()
print("Migration 004 OK")

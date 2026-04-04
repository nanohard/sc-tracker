const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'mining_yields.db');
const db = new sqlite3.Database(dbPath);

const initPromise = new Promise((resolve, reject) => {
  db.serialize(() => {
    let tasksRemaining = 2; // Check for yields and miners tables
    
    function checkDone() {
      tasksRemaining--;
      if (tasksRemaining === 0) {
        resolve();
      }
    }

    // Check schema for yields table
    db.all("PRAGMA table_info(yields)", (err, rows) => {
      if (err) {
        console.error("Error checking table info:", err);
        checkDone();
        return;
      }
      
      if (rows && rows.length > 0) {
        const hasQuality = rows.some(r => r.name === 'quality');
        const hasMinerName = rows.some(r => r.name === 'miner_name');
        const hasLocation = rows.some(r => r.name === 'location');
        const hasUuid = rows.some(r => r.name === 'uuid');
        const hasUpdatedAt = rows.some(r => r.name === 'updated_at');
        const hasIsDeleted = rows.some(r => r.name === 'is_deleted');
        
        if (!hasQuality) {
          console.log("Old schema detected. Migrating yields table (missing quality)...");
          db.run("DROP TABLE yields", (err) => {
            if (err) console.error("Error dropping table:", err);
            createYieldsTable();
            checkDone();
          });
          return;
        }
        
        if (!hasMinerName) {
          console.log("Adding miner_name column to yields table...");
          db.run("ALTER TABLE yields ADD COLUMN miner_name TEXT DEFAULT 'Unknown'");
        }
        if (!hasLocation) {
          console.log("Adding location column to yields table...");
          db.run("ALTER TABLE yields ADD COLUMN location TEXT DEFAULT 'Unknown'");
        }
        if (!hasUuid) {
          console.log("Adding uuid column to yields table...");
          db.run("ALTER TABLE yields ADD COLUMN uuid TEXT");
          db.run("UPDATE yields SET uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))) WHERE uuid IS NULL");
        }
        if (!hasUpdatedAt) {
          console.log("Adding updated_at column to yields table...");
          db.run("ALTER TABLE yields ADD COLUMN updated_at DATETIME", (err) => {
            if (!err) {
              db.run("UPDATE yields SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL");
            }
          });
        }
        if (!hasIsDeleted) {
          console.log("Adding is_deleted column to yields table...");
          db.run("ALTER TABLE yields ADD COLUMN is_deleted BOOLEAN DEFAULT 0");
        }
      }
      createYieldsTable();
      checkDone();
    });

    // Check schema for miners table
    db.all("PRAGMA table_info(miners)", (err, rows) => {
      if (err) {
        console.error("Error checking miners table info:", err);
        checkDone();
        return;
      }
      
      if (rows && rows.length > 0) {
        const hasTotalYield = rows.some(r => r.name === 'total_yield');
        const hasUuid = rows.some(r => r.name === 'uuid');
        const hasUpdatedAt = rows.some(r => r.name === 'updated_at');
        const hasIsDeleted = rows.some(r => r.name === 'is_deleted');

        if (!hasTotalYield) {
          console.log("Migrating miners table (adding cumulative columns)...");
          db.run("ALTER TABLE miners ADD COLUMN total_yield REAL DEFAULT 0");
          db.run("ALTER TABLE miners ADD COLUMN total_quality_sum REAL DEFAULT 0");
          db.run("ALTER TABLE miners ADD COLUMN record_count INTEGER DEFAULT 0", (err) => {
            if (!err) {
              db.run(`
                UPDATE miners SET 
                  total_yield = (SELECT IFNULL(SUM(yield_cscu), 0) FROM yields WHERE miner_name = miners.name),
                  total_quality_sum = (SELECT IFNULL(SUM(quality), 0) FROM yields WHERE miner_name = miners.name),
                  record_count = (SELECT COUNT(*) FROM yields WHERE miner_name = miners.name)
              `);
            }
          });
        }
        if (!hasUuid) {
          console.log("Adding uuid column to miners table...");
          db.run("ALTER TABLE miners ADD COLUMN uuid TEXT");
          db.run("UPDATE miners SET uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))) WHERE uuid IS NULL");
        }
        if (!hasUpdatedAt) {
          console.log("Adding updated_at column to miners table...");
          db.run("ALTER TABLE miners ADD COLUMN updated_at DATETIME", (err) => {
            if (!err) {
              db.run("UPDATE miners SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL");
            }
          });
        }
        if (!hasIsDeleted) {
          console.log("Adding is_deleted column to miners table...");
          db.run("ALTER TABLE miners ADD COLUMN is_deleted BOOLEAN DEFAULT 0");
        }
      }
      createMinersTable();
      createSyncSettingsTable();
      ensureNoneMinerExists();
      checkDone();
    });
  });
});

function ensureNoneMinerExists() {
  db.get("SELECT id FROM miners WHERE name = 'None'", (err, row) => {
    if (!row) {
      const uuidSql = "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))";
      db.run(`INSERT INTO miners (name, uuid, updated_at) VALUES ('None', ${uuidSql}, CURRENT_TIMESTAMP)`);
    }
  });
}

function createYieldsTable() {
  db.run(`CREATE TABLE IF NOT EXISTS yields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE,
    material TEXT,
    quality REAL,
    yield_cscu REAL,
    miner_name TEXT DEFAULT 'Unknown',
    location TEXT DEFAULT 'Unknown',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT 0
  )`, (err) => {
    if (!err) {
      db.run("DROP INDEX IF EXISTS idx_material_quality");
      db.run("DROP INDEX IF EXISTS idx_material_quality_miner");
      db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_material_quality_miner_loc ON yields(material, quality, miner_name, location) WHERE is_deleted = 0");
    }
  });
}

function createMinersTable() {
  db.run(`CREATE TABLE IF NOT EXISTS miners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE,
    name TEXT UNIQUE NOT NULL,
    total_yield REAL DEFAULT 0,
    total_quality_sum REAL DEFAULT 0,
    record_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT 0
  )`);
}

function createSyncSettingsTable() {
  db.run(`CREATE TABLE IF NOT EXISTS sync_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`, (err) => {
    if (!err) {
      // Initialize local Sync UUID if not exists
      db.get("SELECT value FROM sync_settings WHERE key = 'local_sync_uuid'", (err, row) => {
        if (!row) {
          // Generate a UUID using SQLite's randomblob for reliability
          const uuidSql = "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))";
          db.run(`INSERT INTO sync_settings (key, value) VALUES ('local_sync_uuid', ${uuidSql})`);
        }
      });
      // Ensure peer_uuids entry exists
      db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
        if (!row) {
          db.run("INSERT INTO sync_settings (key, value) VALUES ('peer_uuids', '[]')");
        }
      });
      // Ensure last_sync_time entry exists
      db.get("SELECT value FROM sync_settings WHERE key = 'last_sync_time'", (err, row) => {
        if (!row) {
          db.run("INSERT INTO sync_settings (key, value) VALUES ('last_sync_time', '0')");
        }
      });
    }
  });
}

module.exports = { db, initPromise };

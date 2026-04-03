const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'mining_yields.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Check if quality column exists, if not, recreate the table or migrate it
  db.all("PRAGMA table_info(yields)", (err, rows) => {
    if (err) {
      console.error("Error checking table info:", err);
      return;
    }
    
    const hasQuality = rows && rows.some(r => r.name === 'quality');
    const hasMinerName = rows && rows.some(r => r.name === 'miner_name');
    const hasLocation = rows && rows.some(r => r.name === 'location');
    
    if (rows && rows.length > 0 && !hasQuality) {
      console.log("Old schema detected. Migrating yields table (missing quality)...");
      db.run("DROP TABLE yields", (err) => {
        if (err) console.error("Error dropping table:", err);
        createYieldsTable();
      });
    } else if (rows && rows.length > 0 && !hasMinerName) {
      console.log("Old schema detected. Adding miner_name column to yields table...");
      db.run("ALTER TABLE yields ADD COLUMN miner_name TEXT DEFAULT 'Unknown'", (err) => {
        if (err) console.error("Error adding miner_name column:", err);
        createYieldsTable();
      });
    } else if (rows && rows.length > 0 && !hasLocation) {
      console.log("Old schema detected. Adding location column to yields table...");
      db.run("ALTER TABLE yields ADD COLUMN location TEXT DEFAULT 'Unknown'", (err) => {
        if (err) console.error("Error adding location column:", err);
        createYieldsTable();
      });
    } else {
      createYieldsTable();
    }
  });

  // Create miners table
  createMinersTable();
  ensureNoneMinerExists();
});

function ensureNoneMinerExists() {
  db.run("INSERT OR IGNORE INTO miners (name) VALUES ('None')");
}

function createYieldsTable() {
  db.run(`CREATE TABLE IF NOT EXISTS yields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material TEXT,
    quality REAL,
    yield_cscu REAL,
    miner_name TEXT DEFAULT 'Unknown',
    location TEXT DEFAULT 'Unknown',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (!err) {
      // Re-create or create index. We don't want unique index if we want same material/quality for different miners?
      // Actually, if a miner enters same material/quality it should probably merge for THAT miner.
      // So unique index should probably be (material, quality, miner_name, location).
      // Drop old index first if it exists.
      db.run("DROP INDEX IF EXISTS idx_material_quality");
      db.run("DROP INDEX IF EXISTS idx_material_quality_miner");
      db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_material_quality_miner_loc ON yields(material, quality, miner_name, location)");
    }
  });
}

function createMinersTable() {
  db.run(`CREATE TABLE IF NOT EXISTS miners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    total_yield REAL DEFAULT 0,
    total_quality_sum REAL DEFAULT 0,
    record_count INTEGER DEFAULT 0
  )`, (err) => {
    if (!err) {
      // Check if columns exist (for migration)
      db.all("PRAGMA table_info(miners)", (err, rows) => {
        if (!err && rows) {
          const hasTotalYield = rows.some(r => r.name === 'total_yield');
          if (!hasTotalYield) {
            console.log("Migrating miners table (adding cumulative columns)...");
            db.serialize(() => {
              db.run("ALTER TABLE miners ADD COLUMN total_yield REAL DEFAULT 0");
              db.run("ALTER TABLE miners ADD COLUMN total_quality_sum REAL DEFAULT 0");
              db.run("ALTER TABLE miners ADD COLUMN record_count INTEGER DEFAULT 0", (err) => {
                if (!err) {
                  // Initialize cumulative stats from existing yields
                  db.run(`
                    UPDATE miners SET 
                      total_yield = (SELECT IFNULL(SUM(yield_cscu), 0) FROM yields WHERE miner_name = miners.name),
                      total_quality_sum = (SELECT IFNULL(SUM(quality), 0) FROM yields WHERE miner_name = miners.name),
                      record_count = (SELECT COUNT(*) FROM yields WHERE miner_name = miners.name)
                  `);
                }
              });
            });
          }
        }
      });
    }
  });
}

module.exports = db;

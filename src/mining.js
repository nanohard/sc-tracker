const { ipcMain, app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const { Jimp } = require('jimp');
const crypto = require('crypto');
const { db } = require('./database');
const { broadcastSync } = require('./sync');

let mainWindow;

function setMainWindow(win) {
  mainWindow = win;
}

// OCR Processing
ipcMain.handle('process-image', async (event, imagePath) => {
  if (!imagePath) {
    throw new Error('No image path provided to OCR processor.');
  }

  const tempPath = path.join(app.getPath('temp'), `processed_${Date.now()}.png`);
  
  try {
    console.log('Pre-processing image...');
    const image = await Jimp.read(imagePath);
    
    const newWidth = image.bitmap.width * 6;
    image.resize({ w: newWidth }); 
    
    image.greyscale();
    image.normalize();
    image.contrast(0.3); 
    
    image.threshold({ max: 255, replace: 255, auto: true });
    image.invert();
    
    await image.write(tempPath);
    console.log('Pre-processing complete. Saved to:', tempPath);

    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => console.log(m)
    });

    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,\n',
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });

    const { data: { text } } = await worker.recognize(tempPath);
    await worker.terminate();

    try {
      fs.unlinkSync(tempPath);
    } catch (err) {
      console.warn('Failed to delete temp file:', err);
    }

    return text;
  } catch (error) {
    console.error('OCR or Pre-processing Error:', error);
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch(e) {}
    }
    throw error;
  }
});

// Database Operations
ipcMain.handle('get-locations', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT location, COUNT(DISTINCT material || "_" || quality) as count FROM yields WHERE yield_cscu > 0 AND is_deleted = 0 GROUP BY location ORDER BY location ASC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('get-yields-by-location', async (event, { location, sortBy = 'quality', sortOrder = 'DESC' }) => {
  return new Promise((resolve, reject) => {
    const allowedColumns = ['quality', 'yield_cscu', 'material'];
    const allowedOrders = ['ASC', 'DESC'];
    
    const actualSortBy = allowedColumns.includes(sortBy) ? sortBy : 'quality';
    const actualSortOrder = allowedOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

    db.all(
      `SELECT MIN(id) as id, material, quality, SUM(yield_cscu) as yield_cscu, 'Aggregated' as miner_name 
       FROM yields 
       WHERE location = ? AND is_deleted = 0 
       GROUP BY material, quality 
       ORDER BY material, ${actualSortBy} ${actualSortOrder}`,
      [location],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
});

ipcMain.handle('get-ore-locations-by-miner', async () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, miner_name, material, location, quality, yield_cscu, timestamp 
       FROM yields 
       WHERE is_deleted = 0 
       ORDER BY miner_name ASC, timestamp DESC`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
});

async function processOrdersForYield(material, quality, yield_cscu, miner_name) {
  const now = new Date().toISOString();
  return new Promise(resolve => {
    db.all(
      "SELECT * FROM orders WHERE material = ? AND min_quality <= ? AND status = 'Pending' AND is_deleted = 0 ORDER BY min_quality DESC, created_at ASC",
      [material, quality],
      (err, orders) => {
        if (err || !orders || orders.length === 0) {
          resolve();
          return;
        }

        let remainingYield = yield_cscu;
        const updatePromises = [];

        for (const order of orders) {
          if (remainingYield <= 0) break;

          const needed = order.quantity - order.quantity_mined;
          if (needed <= 0) continue;

          const amountToAdd = Math.min(needed, remainingYield);
          const newQuantityMined = order.quantity_mined + amountToAdd;
          remainingYield -= amountToAdd;

          const newStatus = newQuantityMined >= order.quantity ? 'Completed' : 'Pending';

          updatePromises.push(new Promise(res => {
            db.serialize(() => {
              db.run(
                "UPDATE orders SET quantity_mined = ?, status = ?, updated_at = ? WHERE uuid = ?",
                [newQuantityMined, newStatus, now, order.uuid]
              );
              
              const contribUuid = crypto.randomUUID();
              db.run(
                "INSERT INTO order_contributions (uuid, order_uuid, miner_name, material, quantity, quality, timestamp, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [contribUuid, order.uuid, miner_name, material, amountToAdd, quality, now, now, 0],
                () => res()
              );
            });
          }));
        }

        Promise.all(updatePromises).then(() => {
          if (updatePromises.length > 0) broadcastSync('mining');
          resolve();
        });
      }
    );
  });
}

ipcMain.handle('save-yield', async (event, yieldData) => {
  const { material, quality, yield_cscu, miner_name, location } = yieldData;

  if (!miner_name || miner_name === 'Unknown') {
    throw new Error('Miner name is required.');
  }

  const actualMinerName = miner_name;
  const actualLocation = location || 'Unknown';
  const now = new Date().toISOString();

  await processOrdersForYield(material, quality, yield_cscu, actualMinerName);

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('INSERT OR IGNORE INTO miners (name, uuid, updated_at) VALUES (?, ?, ?)', [actualMinerName, crypto.randomUUID(), now], (err) => {
        if (err) console.error('Error inserting miner:', err);
      });
      
      db.run(`
        UPDATE miners SET 
          total_yield = total_yield + ?, 
          total_quality_sum = total_quality_sum + ?, 
          record_count = record_count + ?,
          updated_at = ?
        WHERE name = ?
      `, [yield_cscu, quality, 1, now, actualMinerName], (err) => {
        if (err) console.error('Error updating miner stats:', err);
      });

      const uuid = crypto.randomUUID();
      db.run(`
        INSERT INTO yields (uuid, material, quality, yield_cscu, miner_name, location, timestamp, updated_at, is_deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(material, quality, miner_name, location) WHERE is_deleted = 0
        DO UPDATE SET 
          yield_cscu = yields.yield_cscu + excluded.yield_cscu, 
          updated_at = excluded.updated_at
      `, [uuid, material, quality, yield_cscu, actualMinerName, actualLocation, now, now, 0], function(err) {
        if (err) {
          reject(err);
        } else {
          broadcastSync('mining');
          resolve({ id: this.lastID, updated: this.changes === 0 });
        }
      });
    });
  });
});

ipcMain.handle('update-yield', async (event, yieldData) => {
  const result = await new Promise(async (resolve, reject) => {
    const { id, material, quality, yield_cscu, miner_name, location } = yieldData;
    const actualLocation = location || 'Unknown';
    const now = new Date().toISOString();

    await processOrdersForYield(material, quality, yield_cscu, miner_name);

    if (miner_name === 'Aggregated') {
      db.get('SELECT material, quality, location, uuid FROM yields WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        if (row) {
          db.serialize(() => {
            db.run('UPDATE yields SET is_deleted = 1, updated_at = ? WHERE material = ? AND quality = ? AND location = ? AND is_deleted = 0', [now, row.material, row.quality, row.location]);
            db.run(
              'INSERT INTO yields (uuid, material, quality, yield_cscu, miner_name, location, timestamp, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [crypto.randomUUID(), material, quality, yield_cscu, 'Aggregated', actualLocation, now, now, 0],
              (err) => {
                if (err) reject(err);
                else resolve(true);
              }
            );
          });
        } else {
          resolve(false);
        }
      });
      return;
    }

    const actualMinerName = miner_name;
    db.get('SELECT id, yield_cscu, uuid FROM yields WHERE material = ? AND quality = ? AND miner_name = ? AND location = ? AND id != ? AND is_deleted = 0', [material, quality, actualMinerName, actualLocation, id], (err, row) => {
      if (err) return reject(err);
      if (row) {
        const newTotalYield = row.yield_cscu + yield_cscu;
        db.serialize(() => {
          db.run('UPDATE yields SET yield_cscu = ?, updated_at = ? WHERE id = ?', [newTotalYield, now, row.id]);
          db.run('UPDATE yields SET is_deleted = 1, updated_at = ? WHERE id = ?', [now, id], (err) => {
            if (err) reject(err);
            else resolve(true);
          });
        });
      } else {
        db.run(
          'UPDATE yields SET material = ?, quality = ?, yield_cscu = ?, miner_name = ?, location = ?, updated_at = ? WHERE id = ?',
          [material, quality, yield_cscu, actualMinerName, actualLocation, now, id],
          function (err) {
            if (err) reject(err);
            else resolve(true);
          }
        );
      }
    });
  });
  broadcastSync('mining');
  return result;
});

ipcMain.handle('delete-yield', async (event, id) => {
  const result = await new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run('UPDATE yields SET is_deleted = 1, updated_at = ? WHERE id = ?', [now, id], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
  broadcastSync('mining');
  return result;
});

ipcMain.handle('get-miners', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM miners WHERE is_deleted = 0 ORDER BY name ASC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('add-miner', async (event, name) => {
  const result = await new Promise((resolve, reject) => {
    const uuid = crypto.randomUUID();
    const now = new Date().toISOString();
    db.run('INSERT INTO miners (name, uuid, updated_at) VALUES (?, ?, ?)', [name, uuid, now], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          reject(new Error('Miner already exists.'));
        } else {
          reject(err);
        }
      } else {
        resolve({ id: this.lastID, uuid, name });
      }
    });
  });
  broadcastSync('mining');
  return result;
});

ipcMain.handle('update-miner', async (event, { id, name }) => {
  const result = await new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run('UPDATE miners SET name = ?, updated_at = ? WHERE id = ?', [name, now, id], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          reject(new Error('Miner name already exists.'));
        } else {
          reject(err);
        }
      } else {
        resolve(true);
      }
    });
  });
  broadcastSync('mining');
  return result;
});

ipcMain.handle('delete-miner', async (event, id) => {
  const result = await new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run('UPDATE miners SET is_deleted = 1, updated_at = ? WHERE id = ?', [now, id], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
  broadcastSync('mining');
  return result;
});

ipcMain.handle('import-csv', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (canceled || filePaths.length === 0) return false;

  const filePath = filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  if (lines.length < 2) throw new Error('CSV file is empty or missing data.');

  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const colIndex = {
    location: header.indexOf('location'),
    ore: header.indexOf('ore'),
    quality: header.indexOf('quality'),
    quantity: header.indexOf('quantity')
  };

  if (colIndex.location === -1 || colIndex.ore === -1 || colIndex.quality === -1 || colIndex.quantity === -1) {
    throw new Error('CSV must have location, ore, quality, and quantity columns.');
  }

  const minerName = 'None';
  
  const result = await new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.serialize(() => {
      const stmt = db.prepare('INSERT OR IGNORE INTO yields (uuid, location, material, quality, yield_cscu, miner_name, timestamp, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      let errorOccurred = false;

      for (let i = 1; i < lines.length; i++) {
        const parts = [];
        let current = '';
        let inQuotes = false;
        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) {
                parts.push(current.trim());
                current = '';
            } else current += char;
        }
        parts.push(current.trim());

        if (parts.length < 4) continue;

        const location = parts[colIndex.location];
        const ore = parts[colIndex.ore];
        const quality = parseFloat(parts[colIndex.quality]);
        const quantity = parseFloat(parts[colIndex.quantity]);

        if (location && ore && !isNaN(quality) && !isNaN(quantity)) {
          const uuid = crypto.randomUUID();
          stmt.run(uuid, location, ore, quality, quantity, minerName, now, now, 0, (err) => {
            if (err) {
              console.error('Import row error:', err);
              errorOccurred = true;
            }
          });
        }
      }

      stmt.finalize((err) => {
        if (err || errorOccurred) reject(err || new Error('Some rows failed to import. Check console for details.'));
        else resolve(true);
      });
    });
  });
  broadcastSync('mining');
  return result;
});

ipcMain.handle('get-miner-stats', async (event, { sortBy = 'name', sortOrder = 'ASC' } = {}) => {
  return new Promise((resolve, reject) => {
    const allowedSortBy = ['name', 'avg_quality', 'total_yield'];
    const allowedOrders = ['ASC', 'DESC'];
    
    const actualSortByMapping = {
      'name': 'name',
      'avg_quality': 'avg_quality',
      'total_yield': 'total_yield'
    };
    
    const actualSortByCol = allowedSortBy.includes(sortBy) ? actualSortByMapping[sortBy] : 'name';
    const actualSortOrder = allowedOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'ASC';

    const query = `
      SELECT name, 
             CASE WHEN record_count > 0 THEN total_quality_sum / record_count ELSE 0 END as avg_quality, 
             total_yield, 
             record_count as count
      FROM miners
      ORDER BY ${actualSortByCol} ${actualSortOrder}
    `;
    db.all(query, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('get-yields-by-miner', async (event, minerName) => {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT id, material, quality, yield_cscu, location, timestamp FROM yields WHERE miner_name = ? AND is_deleted = 0 ORDER BY timestamp ASC',
      [minerName],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
});

ipcMain.handle('clear-database', async () => {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM yields', (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
});

ipcMain.handle('get-all-yields', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT location, material, quality, SUM(yield_cscu) as yield_cscu FROM yields WHERE is_deleted = 0 GROUP BY location, material, quality ORDER BY location ASC, material ASC, quality DESC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('add-order', async (event, order) => {
  const uuid = crypto.randomUUID();
  const now = new Date().toISOString();
  return new Promise(resolve => {
    db.run(`
      INSERT INTO orders (uuid, material, quantity, quantity_mined, min_quality, status, created_at, updated_at, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [uuid, order.material, order.quantity, 0, order.min_quality, 'Pending', now, now, 0], (err) => {
      if (!err) broadcastSync('mining');
      resolve(!err);
    });
  });
});

ipcMain.handle('get-orders', async () => {
  return new Promise(resolve => {
    db.all("SELECT * FROM orders WHERE is_deleted = 0 ORDER BY created_at DESC", (err, rows) => {
      resolve(rows || []);
    });
  });
});

ipcMain.handle('delete-order', async (event, uuid) => {
  const now = new Date().toISOString();
  return new Promise(resolve => {
    db.run("UPDATE orders SET is_deleted = 1, updated_at = ? WHERE uuid = ?", [now, uuid], (err) => {
      if (!err) broadcastSync('mining');
      resolve(!err);
    });
  });
});

ipcMain.handle('update-order-status', async (event, { uuid, status }) => {
    const now = new Date().toISOString();
    return new Promise(resolve => {
        db.run("UPDATE orders SET status = ?, updated_at = ? WHERE uuid = ?", [status, now, uuid], (err) => {
            if (!err) broadcastSync('mining');
            resolve(!err);
        });
    });
});

ipcMain.handle('get-order-details', async (event, orderUuid) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get("SELECT * FROM orders WHERE uuid = ?", [orderUuid], (err, order) => {
        if (err || !order) {
          resolve(null);
          return;
        }
        db.all(
          "SELECT * FROM order_contributions WHERE order_uuid = ? AND is_deleted = 0 ORDER BY timestamp DESC",
          [orderUuid],
          (err, contributions) => {
            if (err) resolve(null);
            else resolve({ order, contributions });
          }
        );
      });
    });
  });
});

module.exports = {
  setMainWindow
};

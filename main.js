const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const { Jimp } = require('jimp');
const db = require('./database');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false, // Required for nodeIntegration in modern Electron
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// OCR Processing
ipcMain.handle('process-image', async (event, imagePath) => {
  if (!imagePath) {
    throw new Error('No image path provided to OCR processor.');
  }

  // Pre-process image with Jimp: upscale 5x and high contrast
  const tempPath = path.join(app.getPath('temp'), `processed_${Date.now()}.png`);
  
  try {
    console.log('Pre-processing image...');
    const image = await Jimp.read(imagePath);
    
    // Resize to 6x original size for better OCR
    const newWidth = image.bitmap.width * 6;
    image.resize({ w: newWidth }); 
    
    // Convert to grayscale
    image.greyscale();
    
    // Normalize and set contrast
    image.normalize();
    image.contrast(0.3); 
    
    // Thresholding strategy: pure black and white
    image.threshold({ max: 255, replace: 255, auto: true });
    
    // Invert to get black text on white background
    image.invert();
    
    await image.write(tempPath);
    console.log('Pre-processing complete. Saved to:', tempPath);

    // Use Tesseract.js
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => console.log(m)
    });

    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,\n',
      tessedit_pageseg_mode: '6', // PSM 6 for a single uniform block of text
      preserve_interword_spaces: '1', // Help maintain columnar alignment
    });

    const { data: { text } } = await worker.recognize(tempPath);
    await worker.terminate();

    // Clean up temporary file
    try {
      fs.unlinkSync(tempPath);
    } catch (err) {
      console.warn('Failed to delete temp file:', err);
    }

    return text;
  } catch (error) {
    console.error('OCR or Pre-processing Error:', error);
    // Cleanup on error
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch(e) {}
    }
    throw error;
  }
});

// Database Operations
ipcMain.handle('get-locations', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT location, COUNT(DISTINCT material || "_" || quality) as count FROM yields WHERE yield_cscu > 0 GROUP BY location ORDER BY location ASC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('get-yields-by-location', async (event, { location, sortBy = 'quality', sortOrder = 'DESC' }) => {
  return new Promise((resolve, reject) => {
    // Whitelist columns and orders to prevent SQL injection
    const allowedColumns = ['quality', 'yield_cscu', 'material'];
    const allowedOrders = ['ASC', 'DESC'];
    
    const actualSortBy = allowedColumns.includes(sortBy) ? sortBy : 'quality';
    const actualSortOrder = allowedOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

    db.all(
      `SELECT MIN(id) as id, material, quality, SUM(yield_cscu) as yield_cscu, 'Aggregated' as miner_name 
       FROM yields 
       WHERE location = ? 
       GROUP BY material, quality 
       ORDER BY material ASC, ${actualSortBy} ${actualSortOrder}`,
      [location],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
});

ipcMain.handle('save-yield', async (event, yieldData) => {
  return new Promise((resolve, reject) => {
    const { material, quality, yield_cscu, miner_name, location } = yieldData;
    if (!miner_name || miner_name === 'Unknown') {
      return reject(new Error('Miner name is required.'));
    }
    const actualMinerName = miner_name;
    const actualLocation = location || 'Unknown';
    
    db.serialize(() => {
      // Ensure miner exists in miners table
      db.run('INSERT OR IGNORE INTO miners (name) VALUES (?)', [actualMinerName]);
      
      // Update miner stats (cumulative, never subtracted)
      db.run(`
        UPDATE miners SET 
          total_yield = total_yield + ?, 
          total_quality_sum = total_quality_sum + ?, 
          record_count = record_count + 1 
        WHERE name = ?
      `, [yield_cscu, quality, actualMinerName]);

      // Check if an entry with the same material, quality, miner_name and location exists
      db.get('SELECT id, yield_cscu FROM yields WHERE material = ? AND quality = ? AND miner_name = ? AND location = ?', [material, quality, actualMinerName, actualLocation], (err, row) => {
        if (err) return reject(err);
        if (row) {
          // Update existing entry
          const newYield = row.yield_cscu + yield_cscu;
          db.run('UPDATE yields SET yield_cscu = ? WHERE id = ?', [newYield, row.id], (err) => {
            if (err) reject(err);
            else resolve({ id: row.id, updated: true });
          });
        } else {
          // Insert new entry
          db.run(
            'INSERT INTO yields (material, quality, yield_cscu, miner_name, location) VALUES (?, ?, ?, ?, ?)',
            [material, quality, yield_cscu, actualMinerName, actualLocation],
            function (err) {
              if (err) reject(err);
              else resolve({ id: this.lastID, updated: false });
            }
          );
        }
      });
    });
  });
});

ipcMain.handle('update-yield', async (event, yieldData) => {
  return new Promise((resolve, reject) => {
    const { id, material, quality, yield_cscu, miner_name, location } = yieldData;
    
    const actualLocation = location || 'Unknown';

    if (miner_name === 'Aggregated') {
      // Aggregated update: we change the total yield for this material/quality/location
      // Actually we don't have location passed from table yet? We'll see.
      db.get('SELECT material, quality, location FROM yields WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        if (row) {
          db.serialize(() => {
            db.run('DELETE FROM yields WHERE material = ? AND quality = ? AND location = ?', [row.material, row.quality, row.location]);
            db.run(
              'INSERT INTO yields (material, quality, yield_cscu, miner_name, location) VALUES (?, ?, ?, ?, ?)',
              [material, quality, yield_cscu, 'Aggregated', actualLocation],
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

    if (!miner_name || miner_name === 'Unknown') {
      if (miner_name !== 'Aggregated') {
        return reject(new Error('Miner name is required for updates.'));
      }
    }
    const actualMinerName = miner_name;
    // Check if updating to a material/quality/miner/location that already exists (for merging)
    db.get('SELECT id, yield_cscu FROM yields WHERE material = ? AND quality = ? AND miner_name = ? AND location = ? AND id != ?', [material, quality, actualMinerName, actualLocation, id], (err, row) => {
      if (err) return reject(err);
      if (row) {
        // Merge into the existing record and delete this one
        const newTotalYield = row.yield_cscu + yield_cscu;
        db.serialize(() => {
          db.run('UPDATE yields SET yield_cscu = ? WHERE id = ?', [newTotalYield, row.id]);
          db.run('DELETE FROM yields WHERE id = ?', [id], (err) => {
            if (err) reject(err);
            else resolve(true);
          });
        });
      } else {
        // Normal update
        db.run(
          'UPDATE yields SET material = ?, quality = ?, yield_cscu = ?, miner_name = ?, location = ? WHERE id = ?',
          [material, quality, yield_cscu, actualMinerName, actualLocation, id],
          function (err) {
            if (err) reject(err);
            else resolve(true);
          }
        );
      }
    });
  });
});

// Miner Management Operations
ipcMain.handle('get-miners', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM miners ORDER BY name ASC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('add-miner', async (event, name) => {
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO miners (name) VALUES (?)', [name], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          reject(new Error('Miner already exists.'));
        } else {
          reject(err);
        }
      } else {
        resolve({ id: this.lastID, name });
      }
    });
  });
});

ipcMain.handle('update-miner', async (event, { id, name }) => {
  return new Promise((resolve, reject) => {
    db.run('UPDATE miners SET name = ? WHERE id = ?', [name, id], function (err) {
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
});

ipcMain.handle('delete-miner', async (event, id) => {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM miners WHERE id = ?', [id], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
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

  // Header: location, ore, quality, quantity
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
  
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      const stmt = db.prepare('INSERT OR IGNORE INTO yields (location, material, quality, yield_cscu, miner_name) VALUES (?, ?, ?, ?, ?)');
      let errorOccurred = false;

      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parser that handles quotes
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
          stmt.run(location, ore, quality, quantity, minerName, (err) => {
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
      'SELECT id, material, quality, yield_cscu, location, timestamp FROM yields WHERE miner_name = ? ORDER BY timestamp ASC',
      [minerName],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
});

ipcMain.handle('delete-yield', async (event, id) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT material, quality, location FROM yields WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      if (row) {
        db.run('DELETE FROM yields WHERE material = ? AND quality = ? AND location = ?', [row.material, row.quality, row.location], (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      } else {
        resolve(false);
      }
    });
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

ipcMain.handle('show-confirm-dialog', async (event, message) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Yes', 'No'],
    defaultId: 1,
    title: 'Confirm',
    message: message,
  });
  return result.response === 0;
});

ipcMain.handle('show-alert-dialog', async (event, message) => {
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['OK'],
    title: 'Alert',
    message: message,
  });
});

ipcMain.handle('get-all-yields', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT location, material, quality, SUM(yield_cscu) as yield_cscu FROM yields GROUP BY location, material, quality ORDER BY location ASC, material ASC, quality DESC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('save-csv', async (event, csvContent) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to CSV',
    defaultPath: path.join(app.getPath('documents'), 'ore_yields.csv'),
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (filePath) {
    fs.writeFileSync(filePath, csvContent);
    return true;
  }
  return false;
});

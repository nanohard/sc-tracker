const { ipcMain } = require('electron');
const { db } = require('./database');
const { broadcastSync } = require('./sync');

ipcMain.handle('get-inventory', async (event, sort) => {
  const column = sort?.column || 'material';
  const order = sort?.order || 'ASC';
  
  const validColumns = ['material', 'quality', 'quantity', 'location'];
  const sortColumn = validColumns.includes(column) ? column : 'material';
  const sortOrder = order === 'DESC' ? 'DESC' : 'ASC';

  return new Promise((resolve, reject) => {
    let orderClause = `${sortColumn} ${sortOrder}`;
    if (sortColumn === 'quantity' || sortColumn === 'quality') {
      orderClause = `material ASC, ${sortColumn} ${sortOrder}`;
    } else if (sortColumn === 'material') {
      orderClause = `material ${sortOrder}, quality DESC`;
    } else if (sortColumn === 'location') {
      orderClause = `location ${sortOrder}, material ASC, quality DESC`;
    }

    db.all(`SELECT * FROM inventory WHERE is_deleted = 0 ORDER BY ${orderClause}`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
});

ipcMain.handle('transfer-to-inventory', async (event, { yieldId, location }) => {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM yields WHERE id = ?', [yieldId], (err, row) => {
      if (err || !row) {
        reject(err || new Error('Yield not found'));
        return;
      }

      db.serialize(() => {
        db.run('UPDATE yields SET is_deleted = 1, updated_at = ? WHERE id = ?', [now, yieldId]);
        const uuid = require('crypto').randomUUID();
        db.run(
          'INSERT INTO inventory (uuid, material, quality, quantity, location, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uuid, row.material, row.quality, row.yield_cscu, location, now, 0],
          (err) => {
            if (err) reject(err);
            else {
              broadcastSync();
              resolve(true);
            }
          }
        );
      });
    });
  });
});

ipcMain.handle('update-inventory', async (event, { id, quantity, location }) => {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE inventory SET quantity = ?, location = ?, updated_at = ? WHERE id = ?',
      [quantity, location, now, id],
      (err) => {
        if (err) reject(err);
        else {
          broadcastSync();
          resolve(true);
        }
      }
    );
  });
});

ipcMain.handle('delete-inventory', async (event, id) => {
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.run('UPDATE inventory SET is_deleted = 1, updated_at = ? WHERE id = ?', [now, id], (err) => {
      if (err) reject(err);
      else {
        broadcastSync();
        resolve(true);
      }
    });
  });
});

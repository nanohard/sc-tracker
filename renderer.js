const { ipcRenderer, webUtils } = require('electron');

const fileInput = document.getElementById('file-input');
const imagePreview = document.getElementById('image-preview');
const statusDiv = document.getElementById('status');
const rawTextDiv = document.getElementById('raw-text');

const viewOreList = document.getElementById('view-ore-list');
const viewOreDetails = document.getElementById('view-ore-details');
const viewMinerList = document.getElementById('view-miner-list');
const viewStatistics = document.getElementById('view-statistics');
const viewMinerDetails = document.getElementById('view-miner-details');
const oreContainer = document.getElementById('ore-container');
const yieldBody = document.getElementById('yield-body');
const minerBody = document.getElementById('miner-body');
const statsBody = document.getElementById('stats-body');
const minerDetailsBody = document.getElementById('miner-details-body');
const currentOreNameHeader = document.getElementById('current-ore-name');
const currentMinerNameHeader = document.getElementById('current-miner-name');
const backToListBtn = document.getElementById('back-to-list');
const backToStatsBtn = document.getElementById('back-to-stats');
const appTitle = document.getElementById('app-title');
const clearDbBtn = document.getElementById('clear-db-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const importCsvBtn = document.getElementById('import-csv-btn');

const navOresBtn = document.getElementById('nav-ores');
const navMinersBtn = document.getElementById('nav-miners');
const navStatsBtn = document.getElementById('nav-stats');
const navSyncBtn = document.getElementById('nav-sync');
const viewSync = document.getElementById('sync-view');
const localSyncUuidCode = document.getElementById('local-sync-uuid');
const copySyncUuidBtn = document.getElementById('copy-sync-uuid');
const peerListDiv = document.getElementById('peer-list');
const peerUuidInput = document.getElementById('peer-uuid-input');
const addPeerBtn = document.getElementById('add-peer-button');
const syncStatusDiv = document.getElementById('sync-status');
const globalMinerSelect = document.getElementById('global-miner-select');
const globalLocationSelect = document.getElementById('global-location-select');
const editMinerSelect = document.getElementById('edit-miner');
const newMinerNameInput = document.getElementById('new-miner-name');
const addMinerBtn = document.getElementById('add-miner-btn');
const minerStatus = document.getElementById('miner-status');

// Edit Modal Elements
const editModal = document.getElementById('edit-modal');
const editMinerRow = document.getElementById('edit-miner-row');
const editId = document.getElementById('edit-id');
const editMat = document.getElementById('edit-mat');
const editQuality = document.getElementById('edit-quality');
const editYield = document.getElementById('edit-yield');
const editLocation = document.getElementById('edit-location');
const modalSaveBtn = document.getElementById('modal-save-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');

// Miner Edit Modal Elements
const minerEditModal = document.getElementById('miner-edit-modal');
const editMinerId = document.getElementById('edit-miner-id');
const editMinerNameInput = document.getElementById('edit-miner-name');
const minerModalSaveBtn = document.getElementById('miner-modal-save-btn');
const minerModalCancelBtn = document.getElementById('miner-modal-cancel-btn');

// Review Modal Elements
const reviewModal = document.getElementById('review-modal');
const reviewBody = document.getElementById('review-body');
const reviewSaveAllBtn = document.getElementById('review-save-all-btn');
const reviewCancelBtn = document.getElementById('review-cancel-btn');
const reviewRetryBtn = document.getElementById('review-retry-btn');

// Manual Entry Elements
const manualMat = document.getElementById('manual-mat');
const manualLocation = document.getElementById('manual-location');
const manualQuality = document.getElementById('manual-quality');
const manualYield = document.getElementById('manual-yield');
const manualAddBtn = document.getElementById('manual-add-btn');
const manualStatus = document.getElementById('manual-status');
const minerSelectionContainer = document.getElementById('miner-selection-container');
const uploadContainer = document.getElementById('upload-container');
const manualEntryContainer = document.getElementById('manual-entry-container');

// const sortMaterialHeader = document.getElementById('sort-material');
const sortQualityHeader = document.getElementById('sort-quality');
const sortYieldHeader = document.getElementById('sort-yield');
const sortStatsNameHeader = document.getElementById('sort-stats-name');
const sortStatsQualityHeader = document.getElementById('sort-stats-quality');
const sortStatsYieldHeader = document.getElementById('sort-stats-yield');

let currentViewedLocation = null;
let currentSortColumn = 'quality';
let currentSortOrder = 'DESC';

let currentStatsSortColumn = 'name';
let currentStatsSortOrder = 'ASC';

let lastProcessedImagePath = null;

// Initialize
loadLocations();
loadMiners();
loadSyncSettings();
updateSortIndicators();
updateStatsSortIndicators();

ipcRenderer.on('sync-complete', () => {
    syncStatusDiv.textContent = `Last synced: ${new Date().toLocaleTimeString()}`;
    loadLocations();
    loadMiners();
});

async function loadSyncSettings() {
    const settings = await ipcRenderer.invoke('get-sync-settings');
    localSyncUuidCode.textContent = settings.local_sync_uuid || '...';
    
    const peerUuids = JSON.parse(settings.peer_uuids || '[]');
    peerListDiv.innerHTML = '';
    
    if (peerUuids.length === 0) {
        peerListDiv.innerHTML = '<p style="color: #888; margin: 0; font-style: italic;">No peers added yet.</p>';
    } else {
        peerUuids.forEach(uuid => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.marginBottom = '5px';
            div.style.padding = '5px';
            div.style.background = '#222';
            div.style.borderRadius = '4px';
            
            div.innerHTML = `
                <span style="font-family: monospace;">${uuid}</span>
                <button class="secondary delete-btn" style="margin: 0; padding: 2px 8px; font-size: 0.8em;">Remove</button>
            `;
            
            div.querySelector('.delete-btn').addEventListener('click', async () => {
                await ipcRenderer.invoke('remove-peer-uuid', uuid);
                loadSyncSettings();
            });
            
            peerListDiv.appendChild(div);
        });
    }
}

appTitle.addEventListener('click', () => {
    switchView('list');
});

navOresBtn.addEventListener('click', () => {
    switchView('list');
});

navMinersBtn.addEventListener('click', () => {
    switchView('miners');
});

navStatsBtn.addEventListener('click', () => {
    switchView('statistics');
});

navSyncBtn.addEventListener('click', () => {
    switchView('sync');
});

copySyncUuidBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(localSyncUuidCode.textContent);
    copySyncUuidBtn.textContent = 'Copied!';
    setTimeout(() => copySyncUuidBtn.textContent = 'Copy', 2000);
});

addPeerBtn.addEventListener('click', async () => {
    const peerUuid = peerUuidInput.value.trim();
    if (!peerUuid) return;
    const added = await ipcRenderer.invoke('add-peer-uuid', peerUuid);
    if (added) {
        peerUuidInput.value = '';
        loadSyncSettings();
    } else {
        alert('Peer already exists or invalid UUID.');
    }
});

backToListBtn.addEventListener('click', () => {
    switchView('list');
});

backToStatsBtn.addEventListener('click', () => {
    switchView('statistics');
});

// sortMaterialHeader.addEventListener('click', () => {
//     handleSort('material');
// });

sortQualityHeader.addEventListener('click', () => {
    handleSort('quality');
});

sortYieldHeader.addEventListener('click', () => {
    handleSort('yield_cscu');
});

sortStatsNameHeader.addEventListener('click', () => {
    handleStatsSort('name');
});

sortStatsQualityHeader.addEventListener('click', () => {
    handleStatsSort('avg_quality');
});

sortStatsYieldHeader.addEventListener('click', () => {
    handleStatsSort('total_yield');
});

function handleSort(column) {
    if (currentSortColumn === column) {
        currentSortOrder = currentSortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
        currentSortColumn = column;
        currentSortOrder = 'DESC'; // Default to DESC for new column
    }
    
    // Update header arrows
    updateSortIndicators();
    
    if (currentViewedLocation) {
        loadLocationDetails(currentViewedLocation);
    }
}

function updateSortIndicators() {
    // const materialArrow = sortMaterialHeader.querySelector('span');
    const qualityArrow = sortQualityHeader.querySelector('span');
    const yieldArrow = sortYieldHeader.querySelector('span');
    
    // if (materialArrow) materialArrow.innerHTML = '&nbsp;';
    if (qualityArrow) qualityArrow.innerHTML = '&nbsp;';
    if (yieldArrow) yieldArrow.innerHTML = '&nbsp;';
    
    if (currentSortColumn === 'quality') {
        if (qualityArrow) qualityArrow.textContent = currentSortOrder === 'ASC' ? '▲' : '▼';
    } else if (currentSortColumn === 'yield_cscu') {
        if (yieldArrow) yieldArrow.textContent = currentSortOrder === 'ASC' ? '▲' : '▼';
    }
}

function handleStatsSort(column) {
    if (currentStatsSortColumn === column) {
        currentStatsSortOrder = currentStatsSortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
        currentStatsSortColumn = column;
        currentStatsSortOrder = column === 'name' ? 'ASC' : 'DESC';
    }
    
    updateStatsSortIndicators();
    loadMinerStats();
}

function updateStatsSortIndicators() {
    const nameArrow = sortStatsNameHeader.querySelector('span');
    const qualityArrow = sortStatsQualityHeader.querySelector('span');
    const yieldArrow = sortStatsYieldHeader.querySelector('span');
    
    if (nameArrow) nameArrow.innerHTML = '&nbsp;';
    if (qualityArrow) qualityArrow.innerHTML = '&nbsp;';
    if (yieldArrow) yieldArrow.innerHTML = '&nbsp;';
    
    const indicator = currentStatsSortOrder === 'ASC' ? '▲' : '▼';
    
    if (currentStatsSortColumn === 'name') {
        if (nameArrow) nameArrow.textContent = indicator;
    } else if (currentStatsSortColumn === 'avg_quality') {
        if (qualityArrow) qualityArrow.textContent = indicator;
    } else if (currentStatsSortColumn === 'total_yield') {
        if (yieldArrow) yieldArrow.textContent = indicator;
    }
}

clearDbBtn.addEventListener('click', async () => {
    const confirmed = await ipcRenderer.invoke('show-confirm-dialog', 'Are you sure you want to delete ALL mining data? This cannot be undone.');
    if (confirmed) {
        await ipcRenderer.invoke('clear-database');
        await refreshCurrentView();
        statusDiv.textContent = 'Database cleared.';
    }
});

exportCsvBtn.addEventListener('click', async () => {
    try {
        const yields = await ipcRenderer.invoke('get-all-yields');
        if (yields.length === 0) {
            await ipcRenderer.invoke('show-alert-dialog', 'No data to export.');
            return;
        }

        // CSV Header: Location, Ore, Quality, Quantity (Yield)
        let csvContent = 'Location,Ore,Quality,Quantity\n';
        yields.forEach(row => {
            csvContent += `"${row.location}","${row.material}",${row.quality},${row.yield_cscu}\n`;
        });

        const success = await ipcRenderer.invoke('save-csv', csvContent);
        if (success) {
            statusDiv.textContent = 'Export successful.';
        }
    } catch (error) {
        console.error('Export failed:', error);
        await ipcRenderer.invoke('show-alert-dialog', 'Export failed: ' + error.message);
    }
});

importCsvBtn.addEventListener('click', async () => {
    try {
        const success = await ipcRenderer.invoke('import-csv');
        if (success) {
            statusDiv.textContent = 'Import successful.';
            await refreshCurrentView();
        }
    } catch (error) {
        console.error('Import failed:', error);
        await ipcRenderer.invoke('show-alert-dialog', 'Import failed: ' + error.message);
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        let imagePath;
        if (webUtils) {
            imagePath = webUtils.getPathForFile(file);
        } else {
            imagePath = file.path;
        }

        if (imagePath) {
            processImage(imagePath);
        } else {
            statusDiv.textContent = 'Error: Could not retrieve file path.';
        }
        
        // Reset file input value so that selecting the same file again triggers the change event
        fileInput.value = '';
    }
});

async function processImage(imagePath) {
    lastProcessedImagePath = imagePath;
    reviewRetryBtn.style.display = 'none';
    statusDiv.textContent = 'Processing OCR... please wait...';
    imagePreview.src = `file://${imagePath}`;
    imagePreview.style.display = 'block';
    rawTextDiv.style.display = 'none';

    try {
        const text = await ipcRenderer.invoke('process-image', imagePath);
        statusDiv.textContent = 'OCR complete. Automatically recording data...';
        rawTextDiv.textContent = text;
        
        const scMinerals = [
            'Agricium', 'Aluminum', 'Aphorite', 'Aslarite', 'Beryl', 'Bexalite', 'Borase',
            'Copper', 'Corundum', 'Diamond', 'Dolivine', 'Gold', 'Hadanite', 'Hephaestanite',
            'Iron', 'Janalite', 'Laranite', 'Larotite', 'Magnesium', 'Platinum', 'Quantainium', 'Quartz',
            'Savrilium', 'Silver', 'Stileron', 'Tantalite', 'Taranite', 'Titanium', 'Tungsten', 'Zepherite'
        ];

        // Map common OCR errors for minerals
        const mineralMisreads = {
            'Quantainium': ['Quantain', 'Quantein', 'Quantinium'],
            'Beryl': ['Bery', 'Beryll'],
            'Borase': ['Boros', 'Borasee'],
            'Corundum': ['Corund'],
            'Diamond': ['Diamon'],
            'Gold': ['Gald'],
            'Hephaestanite': ['Hephaest', 'Hephast'],
            'Laranite': ['Laranit', 'Lara nite'],
            'Larotite': ['Larotit'],
            'Taranite': ['Taranit'],
            'Titanium': ['Titan'],
            'Tungsten': ['Tungst'],
            'Agricium': ['Agric'],
            'Stileron': ['Stiler'],
            'Aslarite': ['Aslar'],
            'Bexalite': ['Bexal'],
            'Tantalite': ['Tantal'],
            'Zepherite': ['Zepher'],
            'Platinum': ['Platin'],
            'Silver': ['Silv'],
            'Savrilium': ['Savril', 'Savrilium']
        };

        const findMineralInLine = (line) => {
            const lowerLine = line.toLowerCase();
            for (const mineral of scMinerals) {
                const lowerMineral = mineral.toLowerCase();
                // Direct match
                if (lowerLine.includes(lowerMineral)) return mineral;
                // Check misreads
                if (mineralMisreads[mineral]) {
                    for (const misread of mineralMisreads[mineral]) {
                        if (lowerLine.includes(misread.toLowerCase())) return mineral;
                    }
                }
            }
            return null;
        };

        // Helper to extract numbers and handle common OCR misinterpretations
        const cleanOCRText = (str) => {
            let s = str.replace(/[ ]/g, ''); // Remove spaces first
            // Handle multi-char mappings from user or observations
            s = s.replace(/ns/gi, '1');
            
            return s
                .replace(/[Oo]/g, '0')
                .replace(/[liI|!\[\]\(\)]/g, '1')
                .replace(/[Ss$]/g, '5')
                .replace(/[Bb&]/g, '8')
                .replace(/[Zz]/g, '2')
                .replace(/[Gg]/g, '6')
                .replace(/[Tt]/g, '7')
                .replace(/[Aa]/g, '4')
                .replace(/[N]/g, '7')
                .replace(/[n]/g, '1');
        };

        const getNums = (str) => {
            // New regex: allow max 2 spaces/dots between potential digits to prevent joining columns
            // This fixes the "mixing columns" issue when there's large spacing.
            // Added more potential misread characters for numbers.
            const potentialNumberMatches = str.match(/([0-9OoLlIi|!\[\]\(\)Ss$Bb&ZzGgTtAaNn][\s.,]{0,2})+/g) || [];
            
            return potentialNumberMatches
                .map(m => cleanOCRText(m))
                .filter(n => n.length > 0 && n.length <= 4);
        };

        const lines = (text || '').split(/[\n\r]+/).filter(line => line.trim().length > 0);
        
        // If the OCR returned everything in one string without newlines, we try to split it by minerals.
        let processedLines = lines;
        if (lines.length === 1 && text.length > 50) {
             // Try to insert newlines before known minerals to "fake" lines
             let modifiedText = text;
             scMinerals.forEach(m => {
                 const regex = new RegExp(m, 'gi');
                 modifiedText = modifiedText.replace(regex, (match) => `\n${match}`);
             });
             processedLines = modifiedText.split('\n').filter(line => line.trim().length > 0);
        }

        const detectedEntries = [];

        for (let i = 0; i < processedLines.length; i++) {
            const line = processedLines[i].trim();
            const mineral = findMineralInLine(line);

            if (mineral) {
                let quality = 0;
                let yield_cscu = 0;

                let foundNumbers = [];
                
                // Check current line for numbers AFTER the mineral name (or whatever we matched)
                // Use a generic find misread to get the actual match index
                let matchStr = mineral.toLowerCase();
                let lowerLine = line.toLowerCase();
                let index = lowerLine.indexOf(matchStr);
                
                if (index === -1 && mineralMisreads[mineral]) {
                    for (const misread of mineralMisreads[mineral]) {
                        index = lowerLine.indexOf(misread.toLowerCase());
                        if (index !== -1) {
                            matchStr = misread.toLowerCase();
                            break;
                        }
                    }
                }

                const remainingLine = line.substring(index + matchStr.length);
                foundNumbers.push(...getNums(remainingLine));

                // If we don't have enough numbers, check the next 2 lines
                let lookAhead = 1;
                while (foundNumbers.length < 2 && (i + lookAhead) < processedLines.length && lookAhead <= 2) {
                    const nextLine = processedLines[i + lookAhead];
                    const hasAnotherMineral = findMineralInLine(nextLine);
                    if (hasAnotherMineral) break;
                    
                    foundNumbers.push(...getNums(nextLine));
                    lookAhead++;
                }

                // Heuristic: Quality is always 3 digits (middle column).
                // Yield is 1-3 digits (last column).
                if (foundNumbers.length >= 1) {
                    let qStr = "";
                    let qIdxStart = -1;
                    let qIdxEnd = -1;

                    // 1. Look for an existing 3-digit number
                    let existing3DigitIdx = foundNumbers.findIndex(n => n.length === 3);
                    if (existing3DigitIdx !== -1) {
                        qStr = foundNumbers[existing3DigitIdx];
                        qIdxStart = existing3DigitIdx;
                        qIdxEnd = existing3DigitIdx;
                    } 
                    
                    // 2. Handle the "skipped 1" case BEFORE joining columns
                    // Only do this if we haven't found a 3-digit quality yet.
                    if (!qStr && foundNumbers[0].length === 2) {
                        let candidate = foundNumbers[0];
                        // If it starts with 1, it likely missed the leading 7 (e.g., 712 -> 12)
                        if (candidate.startsWith('1')) {
                            qStr = '7' + candidate;
                        } 
                        // If it starts with 6 or 7, it likely missed the middle 1 (e.g., 712 -> 72)
                        else if (candidate.startsWith('6') || candidate.startsWith('7')) {
                            qStr = candidate[0] + '1' + candidate[1];
                        }
                        
                        if (qStr) {
                            qIdxStart = 0;
                            qIdxEnd = 0;
                        }
                    }

                    // 3. If still no 3-digit quality, try to join adjacent numbers
                    if (!qStr) {
                        // Try to join adjacent numbers to get 3 digits
                        for (let j = 0; j < foundNumbers.length; j++) {
                            let combined = foundNumbers[j];
                            for (let k = j + 1; k < foundNumbers.length; k++) {
                                combined += foundNumbers[k];
                                if (combined.length === 3) {
                                    qStr = combined; qIdxStart = j; qIdxEnd = k; break;
                                }
                                if (combined.length > 3) break;
                            }
                            if (qStr) break;
                        }
                    }

                    if (qStr) {
                        // Fix '7' misread as '0'
                        if (qStr.startsWith('0')) qStr = '7' + qStr.substring(1);
                        quality = parseInt(qStr) || 0;

                        // Yield is the next number after Quality
                        let nextNumIdx = qIdxEnd + 1;
                        if (nextNumIdx < foundNumbers.length) {
                            yield_cscu = parseInt(foundNumbers[nextNumIdx]) || 0;
                        }
                    } else {
                        // Fallback
                        let first = foundNumbers[0];
                        if (first.length === 3 && first.startsWith('0')) first = '7' + first.substring(1);
                        quality = parseInt(first) || 0;
                        if (foundNumbers.length >= 2) {
                            yield_cscu = parseInt(foundNumbers[1]) || 0;
                        }
                    }
                }

                if (quality > 0 || yield_cscu > 0) {
                    detectedEntries.push({
                        material: mineral,
                        quality: quality,
                        yield_cscu: yield_cscu
                    });
                }
            }
        }

        if (detectedEntries.length > 0) {
            statusDiv.textContent = `OCR complete. Found ${detectedEntries.length} entries. Please review and confirm.`;
            showReviewModal(detectedEntries);
        } else {
            statusDiv.textContent = 'OCR complete, but no recognizable mining data found.';
        }

    } catch (err) {
        statusDiv.textContent = 'Error during processing: ' + err.message;
        console.error(err);
    }
}

async function loadLocations() {
    const locations = await ipcRenderer.invoke('get-locations');
    oreContainer.innerHTML = '';
    if (locations.length === 0) {
        oreContainer.innerHTML = '<p>No data recorded yet. Upload a screenshot to begin.</p>';
        return;
    }
    locations.forEach(loc => {
        const card = document.createElement('div');
        card.className = 'ore-card';
        const oreText = loc.count === 1 ? 'Ore' : 'Ores';
        card.innerHTML = `
            <h3>${loc.location}</h3>
            <p>${loc.count} ${oreText}</p>
        `;
        card.onclick = () => loadLocationDetails(loc.location);
        oreContainer.appendChild(card);
    });
}

async function loadMiners() {
    let miners = await ipcRenderer.invoke('get-miners');
    
    // Sort so "None" is at the end
    miners.sort((a, b) => {
        if (a.name === 'None') return 1;
        if (b.name === 'None') return -1;
        return a.name.localeCompare(b.name);
    });

    // Update dropdowns
    const dropdowns = [globalMinerSelect, editMinerSelect];
    dropdowns.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Select a Miner...</option>';
        miners.forEach(miner => {
            const option = document.createElement('option');
            option.value = miner.name;
            option.textContent = miner.name;
            select.appendChild(option);
        });
        select.value = currentValue;
        // If current value is no longer in the list, reset to empty
        if (select.selectedIndex === -1) {
            select.value = '';
        }
    });

    // Update miner management list
    minerBody.innerHTML = '';
    miners.forEach(miner => {
        const tr = document.createElement('tr');
        const isNoneMiner = miner.name === 'None';
        tr.innerHTML = `
            <td>${miner.name}</td>
            <td>
                ${!isNoneMiner ? `
                    <button onclick="openMinerEditModal(${miner.id}, '${miner.name.replace(/'/g, "\\'")}')">Edit</button>
                    <button class="danger" onclick="deleteMiner(${miner.id})">Delete</button>
                ` : '<span style="color: #888; font-style: italic; padding: 10px;">System Default</span>'}
            </td>
        `;
        minerBody.appendChild(tr);
    });
}

addMinerBtn.addEventListener('click', async () => {
    const name = newMinerNameInput.value.trim();
    if (!name) {
        minerStatus.textContent = 'Error: Miner name cannot be empty.';
        return;
    }
    try {
        await ipcRenderer.invoke('add-miner', name);
        newMinerNameInput.value = '';
        newMinerNameInput.focus();
        minerStatus.textContent = 'Miner added successfully.';
        await loadMiners();
        setTimeout(() => minerStatus.textContent = '', 3000);
    } catch (err) {
        minerStatus.textContent = 'Error: ' + err.message;
    }
});

window.openMinerEditModal = (id, name) => {
    editMinerId.value = id;
    editMinerNameInput.value = name;
    minerEditModal.style.display = 'block';
};

minerModalCancelBtn.onclick = () => {
    minerEditModal.style.display = 'none';
};

minerModalSaveBtn.onclick = async () => {
    const id = parseInt(editMinerId.value);
    const newName = editMinerNameInput.value.trim();
    if (!newName) {
        await ipcRenderer.invoke('show-alert-dialog', 'Miner name cannot be empty.');
        return;
    }
    try {
        await ipcRenderer.invoke('update-miner', { id, name: newName });
        minerEditModal.style.display = 'none';
        minerStatus.textContent = 'Miner updated successfully.';
        await loadMiners();
        setTimeout(() => minerStatus.textContent = '', 3000);
    } catch (err) {
        await ipcRenderer.invoke('show-alert-dialog', 'Error: ' + err.message);
    }
};


window.deleteMiner = async (id) => {
    const confirmed = await ipcRenderer.invoke('show-confirm-dialog', 'Are you sure you want to delete this miner?');
    if (confirmed) {
        await ipcRenderer.invoke('delete-miner', id);
        await loadMiners();
        newMinerNameInput.focus();
    }
};

async function loadLocationDetails(location) {
    currentViewedLocation = location;
    currentOreNameHeader.textContent = location;
    switchView('details');
    
    const yields = await ipcRenderer.invoke('get-yields-by-location', { 
        location, 
        sortBy: currentSortColumn, 
        sortOrder: currentSortOrder 
    });
    yieldBody.innerHTML = '';
    yields.forEach(row => {
        const tr = document.createElement('tr');
        const qVal = row.quality !== null && row.quality !== undefined ? row.quality : 0;
        const yVal = row.yield_cscu !== null && row.yield_cscu !== undefined ? row.yield_cscu : 0;
        const displayQuality = Math.round(qVal).toString().padStart(3, '0');
        const displayYield = Math.round(yVal).toString();
        
        tr.innerHTML = `
            <td>${row.material}</td>
            <td>${displayQuality}</td>
            <td>${displayYield}</td>
            <td>
                <button onclick="openEditModal(${row.id}, '${row.material.replace(/'/g, "\\'")}', ${row.quality}, ${row.yield_cscu}, '${row.miner_name}', '${location.replace(/'/g, "\\'")}', true)">Edit</button>
                <button class="danger" onclick="deleteYield(${row.id})">Delete</button>
            </td>
        `;
        yieldBody.appendChild(tr);
    });
}

function switchView(view) {
    viewOreList.classList.remove('active');
    viewOreDetails.classList.remove('active');
    viewMinerList.classList.remove('active');
    viewStatistics.classList.remove('active');
    viewMinerDetails.classList.remove('active');
    viewSync.classList.remove('active');

    // Toggle global entry sections based on view
    const isEntryVisible = (view === 'list' || view === 'details');
    const displayStyle = isEntryVisible ? 'block' : 'none';
    minerSelectionContainer.style.display = displayStyle;
    uploadContainer.style.display = displayStyle;
    manualEntryContainer.style.display = displayStyle;
    
    // Manage nav button active states
    navOresBtn.classList.toggle('secondary', view !== 'list');
    navMinersBtn.classList.toggle('secondary', view !== 'miners');
    navStatsBtn.classList.toggle('secondary', view !== 'statistics');
    navSyncBtn.classList.toggle('secondary', view !== 'sync');

    if (view === 'list') {
        viewOreList.classList.add('active');
        loadLocations();
    } else if (view === 'miners') {
        viewMinerList.classList.add('active');
        loadMiners();
    } else if (view === 'statistics') {
        viewStatistics.classList.add('active');
        loadMinerStats();
    } else if (view === 'sync') {
        viewSync.classList.add('active');
        loadSyncSettings();
    } else if (view === 'miner-details') {
        viewMinerDetails.classList.add('active');
    } else {
        viewOreDetails.classList.add('active');
    }
}

async function refreshCurrentView() {
    if (viewOreDetails.classList.contains('active') && currentViewedLocation) {
        await loadLocationDetails(currentViewedLocation);
    } else if (viewStatistics.classList.contains('active')) {
        await loadMinerStats();
    } else if (viewMinerDetails.classList.contains('active')) {
        await loadMinerDetails(currentMinerNameHeader.textContent);
    } else if (viewMinerList.classList.contains('active')) {
        await loadMiners();
    } else if (viewSync.classList.contains('active')) {
        await loadSyncSettings();
    } else {
        await loadLocations();
    }
}

window.deleteYield = async (id) => {
    const confirmed = await ipcRenderer.invoke('show-confirm-dialog', 'Are you sure you want to delete this record?');
    if (confirmed) {
        await ipcRenderer.invoke('delete-yield', id);
        await refreshCurrentView();
    }
};

window.openEditModal = (id, material, quality, yield_cscu, miner_name, location, quantityOnly = false) => {
    editId.value = id;
    editMat.value = material;
    editQuality.value = Math.round(quality);
    editYield.value = Math.round(yield_cscu);
    editMinerSelect.value = (miner_name && miner_name !== 'Unknown') ? miner_name : '';
    editLocation.value = location || '';
    
    // If quantityOnly is true, disable other fields as per user request
    editMat.disabled = quantityOnly;
    editQuality.disabled = quantityOnly;
    editMinerSelect.disabled = quantityOnly;
    editLocation.disabled = quantityOnly;
    editMinerRow.style.display = quantityOnly ? 'none' : 'flex';
    editModal.dataset.quantityOnly = quantityOnly;
    
    editModal.style.display = 'block';
};

modalCancelBtn.onclick = () => {
    editModal.style.display = 'none';
};

modalSaveBtn.onclick = async () => {
    const isQuantityOnly = editModal.dataset.quantityOnly === 'true';
    let miner_name = editMinerSelect.value;
    let location = editLocation.value.trim();
    
    if (isQuantityOnly) {
        miner_name = 'Aggregated';
    } else if (!miner_name) {
        await ipcRenderer.invoke('show-alert-dialog', 'Please select a miner.');
        return;
    }

    const data = {
        id: parseInt(editId.value),
        material: editMat.value,
        quality: Math.round(parseFloat(editQuality.value)) || 0,
        yield_cscu: Math.round(parseFloat(editYield.value)) || 0,
        miner_name: miner_name,
        location: location || 'Unknown'
    };
    
    await ipcRenderer.invoke('update-yield', data);
    await refreshCurrentView();
    editModal.style.display = 'none';
};

manualAddBtn.addEventListener('click', async () => {
    const material = manualMat.value.trim();
    const quality = Math.round(parseFloat(manualQuality.value));
    const yield_cscu = Math.round(parseFloat(manualYield.value));

    if (!material) {
        manualStatus.textContent = 'Error: Material name is required.';
        return;
    }

    if (isNaN(quality) || quality < 0 || quality > 999) {
        manualStatus.textContent = 'Error: Quality must be a number between 0 and 999.';
        return;
    }

    if (isNaN(yield_cscu) || yield_cscu < 0) {
        manualStatus.textContent = 'Error: Yield must be a positive number.';
        return;
    }

    manualStatus.textContent = 'Saving...';

    try {
        const miner_name = globalMinerSelect.value;
        const location = manualLocation.value.trim() || globalLocationSelect.value.trim();
        if (!miner_name) {
            manualStatus.textContent = 'Error: Please select an Active Miner.';
            return;
        }
        await ipcRenderer.invoke('save-yield', { material, quality, yield_cscu, miner_name, location: location || 'Unknown' });
        manualStatus.textContent = `Success: Added ${material} (Q: ${quality}, Y: ${yield_cscu}) at ${location || 'Unknown'} for ${miner_name}`;
        
        // Reset form
        manualMat.value = '';
        manualLocation.value = '';
        manualQuality.value = '';
        manualYield.value = '';
        
        await refreshCurrentView();
        
        // Clear success message after 3 seconds
        setTimeout(() => {
            if (manualStatus.textContent.startsWith('Success')) {
                manualStatus.textContent = '';
            }
        }, 3000);
    } catch (err) {
        manualStatus.textContent = 'Error saving entry: ' + err.message;
        console.error(err);
    }
});

function showReviewModal(entries) {
    reviewBody.innerHTML = '';
    entries.forEach((entry) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" value="${entry.material}" class="review-mat" style="width: 150px;"></td>
            <td><input type="number" value="${entry.quality}" class="review-quality" style="width: 80px;"></td>
            <td><input type="number" value="${entry.yield_cscu}" class="review-yield" style="width: 80px;"></td>
            <td>
                <select class="review-miner miner-select" style="width: 120px;">
                    ${Array.from(globalMinerSelect.options).map(opt => `<option value="${opt.value}" ${opt.value === globalMinerSelect.value ? 'selected' : ''}>${opt.textContent}</option>`).join('')}
                </select>
            </td>
            <td><input type="text" value="${globalLocationSelect.value || 'Unknown'}" class="review-location" list="location-list" style="width: 120px;"></td>
            <td><button class="danger" onclick="this.parentElement.parentElement.remove()">Remove</button></td>
        `;
        reviewBody.appendChild(tr);
    });
    reviewModal.style.display = 'block';
    reviewSaveAllBtn.style.display = 'inline-block';
    reviewRetryBtn.style.display = 'none';
}

reviewCancelBtn.onclick = () => {
    reviewModal.style.display = 'none';
    statusDiv.textContent = 'Detected data discarded.';
    if (lastProcessedImagePath) {
        reviewRetryBtn.style.display = 'inline-block';
        reviewModal.style.display = 'block';
        reviewBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Data discarded. Click Retry to process the image again.</td></tr>';
        reviewSaveAllBtn.style.display = 'none';
    }
};

reviewRetryBtn.onclick = () => {
    if (lastProcessedImagePath) {
        reviewBody.innerHTML = '';
        reviewSaveAllBtn.style.display = 'inline-block';
        processImage(lastProcessedImagePath);
    }
};

reviewSaveAllBtn.onclick = async () => {
    const rows = reviewBody.querySelectorAll('tr');

    // Validate all rows have a miner selected
    for (const row of rows) {
        const miner_name = row.querySelector('.review-miner').value;
        if (!miner_name) {
            await ipcRenderer.invoke('show-alert-dialog', 'Please select a miner for all entries before saving.');
            return;
        }
    }

    let savedCount = 0;
    for (const row of rows) {
        const material = row.querySelector('.review-mat').value;
        const quality = Math.round(parseFloat(row.querySelector('.review-quality').value)) || 0;
        const yield_cscu = Math.round(parseFloat(row.querySelector('.review-yield').value)) || 0;
        const miner_name = row.querySelector('.review-miner').value;
        const location = row.querySelector('.review-location').value.trim() || 'Unknown';
        
        if (material && (quality > 0 || yield_cscu > 0)) {
            await ipcRenderer.invoke('save-yield', { material, quality, yield_cscu, miner_name, location });
            savedCount++;
        }
    }
    reviewModal.style.display = 'none';
    statusDiv.textContent = `Successfully saved ${savedCount} entries to database.`;
    reviewRetryBtn.style.display = 'none';
    await refreshCurrentView();
};

async function loadMinerStats() {
    const stats = await ipcRenderer.invoke('get-miner-stats', { 
        sortBy: currentStatsSortColumn, 
        sortOrder: currentStatsSortOrder 
    });
    statsBody.innerHTML = '';
    stats.forEach(miner => {
        const tr = document.createElement('tr');
        tr.className = 'clickable-row';
        tr.onclick = () => loadMinerDetails(miner.name);
        
        const avgQuality = miner.avg_quality !== null ? Math.round(miner.avg_quality) : 'N/A';
        const totalYield = miner.total_yield !== null ? Math.round(miner.total_yield) : 0;
        
        tr.innerHTML = `
            <td>${miner.name}</td>
            <td>${avgQuality}</td>
            <td>${totalYield}</td>
        `;
        statsBody.appendChild(tr);
    });
}

async function loadMinerDetails(minerName) {
    currentMinerNameHeader.textContent = minerName;
    switchView('miner-details');
    
    const yields = await ipcRenderer.invoke('get-yields-by-miner', minerName);
    minerDetailsBody.innerHTML = '';
    yields.forEach(row => {
        const tr = document.createElement('tr');
        const displayQuality = row.quality !== null ? Math.round(row.quality).toString().padStart(3, '0') : '000';
        const displayYield = row.yield_cscu !== null ? Math.round(row.yield_cscu).toString() : '0';
        const timestamp = new Date(row.timestamp).toLocaleString();
        
        tr.innerHTML = `
            <td>${row.material}</td>
            <td>${displayQuality}</td>
            <td>${displayYield}</td>
            <td>${row.location || 'Unknown'}</td>
            <td>${timestamp}</td>
            <td>
                <button onclick="openEditModal(${row.id}, '${row.material.replace(/'/g, "\\'")}', ${row.quality}, ${row.yield_cscu}, '${minerName.replace(/'/g, "\\'")}', '${(row.location || 'Unknown').replace(/'/g, "\\'")}', false)">Edit</button>
                <button class="danger" onclick="deleteYield(${row.id})">Delete</button>
            </td>
        `;
        minerDetailsBody.appendChild(tr);
    });
}

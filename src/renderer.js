const { ipcRenderer, webUtils } = require('electron');

function applyPermissions() {
    const isCEO = currentUserRole === 'CEO' || currentUserRole === 'Admin';
    const isDirector = currentUserRole === 'Director';
    const isMiner = currentUserRole === 'Miner';
    const isStaff = isCEO || isDirector;

    // Staff only: Member management
    if (navMembersBtn) navMembersBtn.style.display = isStaff ? 'block' : 'none';
    
    // Order creation: Staff only
    const orderCreationSection = submitOrderBtn ? (submitOrderBtn.parentElement ? submitOrderBtn.parentElement.parentElement : null) : null;
    if (orderCreationSection) orderCreationSection.style.display = isStaff ? 'block' : 'none';

    // Mining forms: Staff and Miners
    const canMine = isStaff || isMiner;
    if (manualEntryContainer) manualEntryContainer.style.display = canMine ? 'block' : 'none';
    if (uploadContainer) uploadContainer.style.display = canMine ? 'block' : 'none';
    if (minerSelectionContainer) minerSelectionContainer.style.display = canMine ? 'block' : 'none';

    // Navigation: All accepted roles can see all detail pages (Members are read-only)
    if (navOrdersBtn) navOrdersBtn.style.display = 'block';
    if (navStatsBtn) navStatsBtn.style.display = 'block';
    if (navOreLocationBtn) navOreLocationBtn.style.display = 'block';
    if (dashMiningBtn) dashMiningBtn.style.display = 'block';
    if (dashInventoryBtn) dashInventoryBtn.style.display = 'block';

    // Payout, Delete, and Transfer buttons: Staff only
    document.querySelectorAll('.btn-delete, .btn-transfer, .btn-payout').forEach(btn => {
        btn.style.display = isStaff ? 'inline-block' : 'none';
    });
}

// Initial setup check moved to bottom
async function checkSetup() {
    console.log('Checking setup status...');
    try {
        const status = await ipcRenderer.invoke('get-setup-status');
        console.log('Setup status received:', status);
        if (!status.setupCompleted) {
            setupOverlay.style.display = 'flex';
            setupInitial.style.display = 'block';
        } else {
            currentUserRole = status.userRole;
            currentOrgUuid = status.orgUuid;
            
            // If they joined but aren't accepted yet
            const members = await ipcRenderer.invoke('get-org-members');
            const me = members.find(m => m.uuid === status.localSyncUuid);
            if (status.userRole === 'Member' && (!me || me.status === 'Pending')) {
                setupOverlay.style.display = 'flex';
                setupInitial.style.display = 'none';
                setupPending.style.display = 'block';
                setupPendingStatus.textContent = me ? me.status : 'Pending';
            } else {
                setupOverlay.style.display = 'none';
                applyPermissions();
            }
        }
        loadMiners(); // Load dropdowns
    } catch (err) {
        console.error('Error in checkSetup:', err);
    }
}

ipcRenderer.on('sync-complete', () => {
    refreshCurrentView();
});

ipcRenderer.on('members-updated', () => {
    if (viewMembersList.classList.contains('active')) {
        loadMembers();
    }
});

ipcRenderer.on('role-updated', (event, newRole) => {
    currentUserRole = newRole;
    // If promoted beyond Member, dismiss any pending overlay
    if (newRole !== 'Member' && setupOverlay && setupOverlay.style.display !== 'none') {
        setupOverlay.style.display = 'none';
    }
    applyPermissions();
    loadMiners();
});

ipcRenderer.on('setup-accepted', () => {
    setupOverlay.style.display = 'none';
    applyPermissions();
});

console.log('Renderer process starting...');

const fileInput = document.getElementById('file-input');
const imagePreview = document.getElementById('image-preview');
const statusDiv = document.getElementById('status');
const rawTextDiv = document.getElementById('raw-text');

const viewDashboard = document.getElementById('view-dashboard');
const viewMiningList = document.getElementById('view-mining-list');
const viewOreDetails = document.getElementById('view-ore-details');
const viewStatistics = document.getElementById('view-statistics');
const viewMinerDetails = document.getElementById('view-miner-details');
const viewSync = document.getElementById('view-sync');
const viewOrders = document.getElementById('view-orders');
const viewCompletedOrders = document.getElementById('view-completed-orders');
const viewOreLocation = document.getElementById('view-ore-location');
const viewInventory = document.getElementById('view-inventory');
const viewMembersList = document.getElementById('view-members-list');

const setupOverlay = document.getElementById('setup-overlay');
const setupInitial = document.getElementById('setup-initial');
const setupCreateForm = document.getElementById('setup-create-form');
const setupJoinForm = document.getElementById('setup-join-form');
const setupPending = document.getElementById('setup-pending');
const setupCreateName = document.getElementById('setup-create-name');
const setupJoinUuid = document.getElementById('setup-join-uuid');
const setupJoinName = document.getElementById('setup-join-name');
const pendingMembersBody = document.getElementById('pending-members-body');
const membersBody = document.getElementById('members-body');
const pendingRequestsSection = document.getElementById('pending-requests-section');
const displayOrgUuid = document.getElementById('display-org-uuid');

let currentUserRole = 'Member';
let currentOrgUuid = '';

const oreContainer = document.getElementById('ore-container');
const yieldBody = document.getElementById('yield-body');
const minerBody = document.getElementById('miner-body');
const statsBody = document.getElementById('stats-body');
const oreLocationBody = document.getElementById('ore-location-body');
const inventoryBody = document.getElementById('inventory-body');
const ordersBody = document.getElementById('orders-body');
const completedOrdersBody = document.getElementById('completed-orders-body');
const minerDetailsBody = document.getElementById('miner-details-body');
const currentOreNameHeader = document.getElementById('current-ore-name');
const currentMinerNameHeader = document.getElementById('current-miner-name');
const backToListBtn = document.getElementById('back-to-list');
const backToStatsBtn = document.getElementById('back-to-stats');
// const backToMiningFromMiners = document.getElementById('back-to-mining-from-miners');
const backToMiningFromStats = document.getElementById('back-to-mining-from-stats');
const backToMiningFromOreLoc = document.getElementById('back-to-mining-from-ore-loc');
const backToDashFromSync = document.getElementById('back-to-dash-from-sync');
const backToMiningFromOrders = document.getElementById('back-to-mining-from-orders');
const backToDashFromInventory = document.getElementById('back-to-dash-from-inventory');
const backToOrdersFromCompleted = document.getElementById('back-to-orders-from-completed');
const navDashboardBtn = document.getElementById('nav-dashboard');
const navStatsBtn = document.getElementById('nav-stats');
// const navMinersBtn = document.getElementById('nav-miners');
const navOrdersBtn = document.getElementById('nav-orders');
const navOreLocationBtn = document.getElementById('nav-ore-location');
const navCompletedOrdersBtn = document.getElementById('nav-completed-orders');
const navMembersBtn = document.getElementById('nav-members');
const navResetBtn = document.getElementById('nav-reset');
const backToDashFromMembersBtn = document.getElementById('back-to-dash-from-members');
const setupCreateBtn = document.getElementById('setup-create-btn');
const setupJoinBtn = document.getElementById('setup-join-btn');
const setupCreateSubmit = document.getElementById('setup-create-submit');
const setupCreateBack = document.getElementById('setup-create-back');
const setupJoinSubmit = document.getElementById('setup-join-submit');
const setupJoinBack = document.getElementById('setup-join-back');
const setupPendingRefresh = document.getElementById('setup-pending-refresh');
const setupPendingReset = document.getElementById('setup-pending-reset');
const setupPendingStatus = document.getElementById('setup-pending-status');
const copyOrgUuidBtn = document.getElementById('copy-org-uuid-btn');

const viewOrderDetails = document.getElementById('view-order-details');
const orderDetailsTitle = document.getElementById('order-details-title');
const orderSummaryDiv = document.getElementById('order-summary');
const orderContributionsBody = document.getElementById('order-contributions-body');
const backToOrdersFromDetailsBtn = document.getElementById('back-to-orders-from-details');
const appTitle = document.getElementById('app-title');

const dashMiningBtn = document.getElementById('dash-ores');
const dashInventoryBtn = document.getElementById('dash-inventory');
const dashSyncBtn = document.getElementById('dash-sync-btn');

const localSyncUuidCode = document.getElementById('local-sync-uuid');
const copySyncUuidBtn = document.getElementById('copy-sync-uuid');
const peerListDiv = document.getElementById('peer-list');
const peerNicknameInput = document.getElementById('peer-nickname-input');
const peerUuidInput = document.getElementById('peer-uuid-input');
const addPeerBtn = document.getElementById('add-peer-button');
const syncStatusDiv = document.getElementById('sync-status');
const globalMinerSelect = document.getElementById('global-miner-select');
const globalLocationSelect = document.getElementById('global-location-select');
const newMinerNameInput = document.getElementById('new-miner-name');
const addMinerBtn = document.getElementById('add-miner-btn');
const minerStatus = document.getElementById('miner-status');
const orderOreInput = document.getElementById('order-ore');
const orderQuantityInput = document.getElementById('order-quantity');
const orderQualitySelect = document.getElementById('order-quality');
const submitOrderBtn = document.getElementById('submit-order-btn');
const orderSubmitStatus = document.getElementById('order-submit-status');

// Edit Modal Elements
const editModal = document.getElementById('edit-modal');
const editModalTitle = document.getElementById('edit-modal-title');
const editMatRow = document.getElementById('edit-mat-row');
const editQualityRow = document.getElementById('edit-quality-row');
const editYieldRow = document.getElementById('edit-yield-row');
const editMinerRow = document.getElementById('edit-miner-row');
const editLocationRow = document.getElementById('edit-location-row');
const editYieldLabel = document.getElementById('edit-yield-label');
const editId = document.getElementById('edit-id');
const editMat = document.getElementById('edit-mat');
const editQuality = document.getElementById('edit-quality');
const editYield = document.getElementById('edit-yield');
const editLocation = document.getElementById('edit-location');
const modalSaveBtn = document.getElementById('modal-save-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const editMinerSelect = document.getElementById('edit-miner');

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

// Custom Modal Elements
const customModalOverlay = document.getElementById('custom-modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalCancelBtnCustom = document.getElementById('modal-cancel-btn-custom');

let modalPromiseResolve = null;

function showModal(message, type = 'alert', title = 'Alert') {
    return new Promise((resolve) => {
        modalTitle.textContent = title;
        modalMessage.textContent = message;
        
        if (type === 'confirm') {
            modalConfirmBtn.textContent = 'Yes';
            modalCancelBtnCustom.style.display = 'block';
            modalCancelBtnCustom.textContent = 'No';
        } else {
            modalConfirmBtn.textContent = 'OK';
            modalCancelBtnCustom.style.display = 'none';
        }

        customModalOverlay.style.display = 'flex';
        modalPromiseResolve = resolve;
        modalConfirmBtn.focus();
    });
}

if (modalConfirmBtn) modalConfirmBtn.addEventListener('click', () => {
    customModalOverlay.style.display = 'none';
    if (modalPromiseResolve) {
        modalPromiseResolve(true);
        modalPromiseResolve = null;
    }
});

if (modalCancelBtnCustom) modalCancelBtnCustom.addEventListener('click', () => {
    customModalOverlay.style.display = 'none';
    if (modalPromiseResolve) {
        modalPromiseResolve(false);
        modalPromiseResolve = null;
    }
});

// Transfer Modal Elements
const transferModal = document.getElementById('transfer-modal');
const transferYieldId = document.getElementById('transfer-yield-id');
const transferLocationInput = document.getElementById('transfer-location');
const transferConfirmBtn = document.getElementById('transfer-confirm-btn');
const transferCancelBtn = document.getElementById('transfer-cancel-btn');

// Manual Entry Elements
const manualMat = document.getElementById('manual-mat');
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
const sortOreMinerHeader = document.getElementById('sort-ore-miner');
const sortOreMaterialHeader = document.getElementById('sort-ore-material');
const sortOreLocationHeader = document.getElementById('sort-ore-location');
const sortOreQualityHeader = document.getElementById('sort-ore-quality');
const sortOreQuantityHeader = document.getElementById('sort-ore-quantity');
const sortInventoryMaterialHeader = document.getElementById('sort-inventory-material');
const sortInventoryQualityHeader = document.getElementById('sort-inventory-quality');
const sortInventoryQuantityHeader = document.getElementById('sort-inventory-quantity');
const sortInventoryLocationHeader = document.getElementById('sort-inventory-location');

let currentViewedLocation = null;
let currentSortColumn = 'quality';
let currentSortOrder = 'DESC';

let currentStatsSortColumn = 'name';
let currentStatsSortOrder = 'ASC';

let currentOreSortColumn = 'miner';
let currentOreSortOrder = 'ASC';

let currentInventorySortColumn = 'material';
let currentInventorySortOrder = 'ASC';

let lastProcessedImagePath = null;

// Initialize
try {
    loadMiners();
    loadSyncSettings();
    updateSortIndicators();
    updateStatsSortIndicators();
    updateOreSortIndicators();
    updateInventorySortIndicators();
} catch (err) {
    console.error('Error during initial load:', err);
}

ipcRenderer.on('sync-complete', () => {
    if (syncStatusDiv) {
        syncStatusDiv.textContent = `Last synced: ${new Date().toLocaleTimeString()}`;
    }
    loadMiners();
});

async function loadSyncSettings() {
    const settings = await ipcRenderer.invoke('get-sync-settings');
    if (localSyncUuidCode) {
        localSyncUuidCode.textContent = settings.org_uuid || '...';
    }
    
    if (!peerListDiv) return;
    
    const peerUuids = JSON.parse(settings.peer_uuids || '[]');
    peerListDiv.innerHTML = '';
    
    if (peerUuids.length === 0) {
        peerListDiv.innerHTML = '<p style="color: #888; margin: 0; font-style: italic;">No peers added yet.</p>';
    } else {
        peerUuids.forEach(peer => {
            const uuid = typeof peer === 'string' ? peer : peer.uuid;
            const nickname = typeof peer === 'object' ? peer.nickname : '';
            
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.marginBottom = '5px';
            div.style.padding = '5px';
            div.style.background = '#222';
            div.style.borderRadius = '4px';
            
            div.innerHTML = `
                <div style="display: flex; flex-direction: column; flex-grow: 1;">
                    ${nickname ? `<span style="font-weight: bold; color: #00d2ff;">${nickname}</span>` : ''}
                    <span style="font-family: monospace; font-size: 0.8em; color: #aaa; margin-bottom: 5px;">${uuid}</span>
                    <div style="display: flex; flex-direction: column; gap: 5px; margin-top: 5px;">
                        <div style="display: flex; align-items: center; gap: 15px; font-size: 0.85em;">
                            <span style="width: 70px; color: #888;">Mining:</span>
                            <label style="cursor: pointer; display: flex; align-items: center;">
                                <input type="checkbox" class="allow-mining-check" ${peer.mining?.allowPull !== false ? 'checked' : ''} style="margin: 0; margin-right: 2px; width: auto; height: auto; padding: 0;">Authorize
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center;">
                                <input type="checkbox" class="follow-mining-check" ${peer.mining?.requestPull !== false ? 'checked' : ''} style="margin: 0; margin-right: 2px; width: auto; height: auto; padding: 0;">Follow
                            </label>
                        </div>
                        <div style="display: flex; align-items: center; gap: 15px; font-size: 0.85em;">
                            <span style="width: 70px; color: #888;">Inventory:</span>
                            <label style="cursor: pointer; display: flex; align-items: center;">
                                <input type="checkbox" class="allow-inventory-check" ${peer.inventory?.allowPull !== false ? 'checked' : ''} style="margin: 0; margin-right: 2px; width: auto; height: auto; padding: 0;">Authorize
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center;">
                                <input type="checkbox" class="follow-inventory-check" ${peer.inventory?.requestPull !== false ? 'checked' : ''} style="margin: 0; margin-right: 2px; width: auto; height: auto; padding: 0;">Follow
                            </label>
                        </div>
                    </div>
                </div>
                <button class="secondary delete-btn" style="margin-left: 10px; padding: 2px 8px; font-size: 0.8em;">Remove</button>
            `;
            
            div.querySelector('.allow-mining-check').addEventListener('change', async (e) => {
                await ipcRenderer.invoke('update-peer-permission', uuid, 'mining', 'allowPull', e.target.checked);
            });

            div.querySelector('.follow-mining-check').addEventListener('change', async (e) => {
                await ipcRenderer.invoke('update-peer-permission', uuid, 'mining', 'requestPull', e.target.checked);
            });

            div.querySelector('.allow-inventory-check').addEventListener('change', async (e) => {
                await ipcRenderer.invoke('update-peer-permission', uuid, 'inventory', 'allowPull', e.target.checked);
            });

            div.querySelector('.follow-inventory-check').addEventListener('change', async (e) => {
                await ipcRenderer.invoke('update-peer-permission', uuid, 'inventory', 'requestPull', e.target.checked);
            });

            div.querySelector('.delete-btn').addEventListener('click', async () => {
                const confirmed = await showModal(`Remove peer ${nickname || uuid}?`, 'confirm', 'Confirm Removal');
                if (confirmed) {
                    await ipcRenderer.invoke('remove-peer-uuid', uuid);
                    loadSyncSettings();
                }
            });
            
            peerListDiv.appendChild(div);
        });
    }
}

if (appTitle) appTitle.addEventListener('click', () => {
    switchView('dashboard');
});

if (dashMiningBtn) dashMiningBtn.addEventListener('click', () => {
    switchView('mining');
});

if (dashInventoryBtn) dashInventoryBtn.addEventListener('click', () => {
    switchView('inventory');
});

if (navStatsBtn) navStatsBtn.addEventListener('click', () => {
    switchView('statistics');
});

if (navOreLocationBtn) navOreLocationBtn.addEventListener('click', () => {
    switchView('ore-location');
});

// if (navMinersBtn) navMinersBtn.addEventListener('click', () => {
//     switchView('members');
// });

if (navMembersBtn) navMembersBtn.addEventListener('click', () => {
    switchView('members');
});

if (navResetBtn) navResetBtn.addEventListener('click', async () => {
    const confirm = await showModal('Are you sure you want to RESET ALL DATA and remove yourself from this Organization? This cannot be undone and you will receive a new User UUID.', 'confirm', 'Confirm Reset');
    if (confirm) {
        const result = await ipcRenderer.invoke('reset-setup');
        if (result) {
            // Reset local state
            currentUserRole = 'Member';
            currentOrgUuid = '';
            
            // Show setup overlay
            setupOverlay.style.display = 'flex';
            setupInitial.style.display = 'block';
            setupCreateForm.style.display = 'none';
            setupJoinForm.style.display = 'none';
            setupPending.style.display = 'none';
            
            // Clear any active views and go back to dashboard (behind overlay)
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            viewDashboard.classList.add('active');
            
            // Refresh data (should be empty now)
            if (typeof refreshCurrentView === 'function') refreshCurrentView();
            if (typeof loadMiners === 'function') loadMiners();
            
            await showModal('All data has been cleared. You can now create or join a new organization.');
        }
    }
});

if (backToDashFromMembersBtn) backToDashFromMembersBtn.addEventListener('click', () => {
    switchView('dashboard');
});

if (setupCreateBtn) setupCreateBtn.addEventListener('click', () => {
    setupInitial.style.display = 'none';
    setupCreateForm.style.display = 'block';
});

if (setupJoinBtn) setupJoinBtn.addEventListener('click', () => {
    setupInitial.style.display = 'none';
    setupJoinForm.style.display = 'block';
});

if (setupCreateBack) setupCreateBack.addEventListener('click', () => {
    setupCreateForm.style.display = 'none';
    setupInitial.style.display = 'block';
});

if (setupJoinBack) setupJoinBack.addEventListener('click', () => {
    setupJoinForm.style.display = 'none';
    setupInitial.style.display = 'block';
});

if (setupCreateSubmit) setupCreateSubmit.addEventListener('click', async () => {
    const name = setupCreateName ? setupCreateName.value.trim() : '';
    if (!name) {
        await showModal('Please enter your name.');
        return;
    }
    const result = await ipcRenderer.invoke('create-org', name);
    if (result) {
        currentUserRole = result.userRole;
        currentOrgUuid = result.orgUuid;
        setupOverlay.style.display = 'none';
        applyPermissions();
        loadMiners();
    }
});

if (setupJoinSubmit) setupJoinSubmit.addEventListener('click', async () => {
    const uuid = setupJoinUuid.value.trim();
    const name = setupJoinName.value.trim();
    if (!uuid || !name) {
        await showModal('Please enter both Org UUID and your name.');
        return;
    }
    const result = await ipcRenderer.invoke('join-org', { uuid, name });
    if (result) {
        currentUserRole = result.userRole;
        currentOrgUuid = result.orgUuid;
        setupJoinForm.style.display = 'none';
        setupPending.style.display = 'block';
    }
});

if (setupPendingRefresh) setupPendingRefresh.addEventListener('click', async () => {
    const status = await ipcRenderer.invoke('get-setup-status');
    if (status.userRole !== 'Member' || status.orgUuid) {
        // If role was updated by admin
        currentUserRole = status.userRole;
        currentOrgUuid = status.orgUuid;
        // Check if actually accepted in members list
        const members = await ipcRenderer.invoke('get-org-members');
        const me = members.find(m => m.uuid === status.localSyncUuid);
        if (me && me.status === 'Accepted') {
            setupOverlay.style.display = 'none';
            applyPermissions();
        } else {
            setupPendingStatus.textContent = me ? me.status : 'Pending';
        }
    }
});

if (setupPendingReset) setupPendingReset.addEventListener('click', async () => {
    const confirm = await showModal('Are you sure you want to cancel your request and start over? This will clear your current local data and generate a new User UUID.', 'confirm', 'Confirm Cancel');
    if (confirm) {
        const result = await ipcRenderer.invoke('reset-setup');
        if (result) {
            setupPending.style.display = 'none';
            setupInitial.style.display = 'block';
            
            // Clear any active views and go back to dashboard (behind overlay)
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            viewDashboard.classList.add('active');
            
            // Refresh data (should be empty now)
            if (typeof refreshCurrentView === 'function') refreshCurrentView();
            if (typeof loadMiners === 'function') loadMiners();
        }
    }
});

if (copyOrgUuidBtn) copyOrgUuidBtn.addEventListener('click', () => {
    const uuidText = displayOrgUuid.textContent.replace('Org UUID: ', '');
    navigator.clipboard.writeText(uuidText);
    copyOrgUuidBtn.textContent = 'Copied!';
    setTimeout(() => copyOrgUuidBtn.textContent = 'Copy Org UUID', 2000);
});

if (dashSyncBtn) dashSyncBtn.addEventListener('click', () => {
    switchView('sync');
});

if (navDashboardBtn) navDashboardBtn.addEventListener('click', () => {
    switchView('dashboard');
});

if (copySyncUuidBtn) {
    copySyncUuidBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(localSyncUuidCode.textContent);
        copySyncUuidBtn.textContent = 'Copied!';
        setTimeout(() => copySyncUuidBtn.textContent = 'Copy Org UUID', 2000);
    });
}

if (addPeerBtn) {
    addPeerBtn.addEventListener('click', async () => {
        const peerUuid = peerUuidInput.value.trim();
        const nickname = peerNicknameInput.value.trim();
        if (!peerUuid) return;
        const added = await ipcRenderer.invoke('add-peer-uuid', peerUuid, nickname);
        if (added) {
            peerUuidInput.value = '';
            peerNicknameInput.value = '';
            loadSyncSettings();
        } else {
            await showModal('Peer already exists or invalid UUID.');
        }
    });
}

if (backToListBtn) backToListBtn.addEventListener('click', () => {
    switchView('mining');
});

if (backToStatsBtn) backToStatsBtn.addEventListener('click', () => {
    switchView('statistics');
});

// if (backToMiningFromMiners) backToMiningFromMiners.addEventListener('click', () => {
//     switchView('mining');
// });

if (backToMiningFromStats) backToMiningFromStats.addEventListener('click', () => {
    switchView('mining');
});

if (backToMiningFromOreLoc) backToMiningFromOreLoc.addEventListener('click', () => {
    switchView('mining');
});

if (backToDashFromSync) backToDashFromSync.addEventListener('click', () => {
    switchView('dashboard');
});

if (backToDashFromInventory) backToDashFromInventory.addEventListener('click', () => {
    switchView('dashboard');
});

// sortMaterialHeader.addEventListener('click', () => {
//     handleSort('material');
// });

if (sortQualityHeader) sortQualityHeader.addEventListener('click', () => {
    handleSort('quality');
});

if (sortYieldHeader) sortYieldHeader.addEventListener('click', () => {
    handleSort('yield_cscu');
});

if (sortStatsNameHeader) sortStatsNameHeader.addEventListener('click', () => {
    handleStatsSort('name');
});

if (sortStatsQualityHeader) sortStatsQualityHeader.addEventListener('click', () => {
    handleStatsSort('avg_quality');
});

if (sortStatsYieldHeader) sortStatsYieldHeader.addEventListener('click', () => {
    handleStatsSort('total_yield');
});

if (sortOreMinerHeader) sortOreMinerHeader.addEventListener('click', () => {
    handleOreSort('miner');
});

if (sortOreMaterialHeader) sortOreMaterialHeader.addEventListener('click', () => {
    handleOreSort('material');
});

if (sortOreLocationHeader) sortOreLocationHeader.addEventListener('click', () => {
    handleOreSort('location');
});

if (sortOreQualityHeader) sortOreQualityHeader.addEventListener('click', () => {
    handleOreSort('quality');
});

if (sortOreQuantityHeader) sortOreQuantityHeader.addEventListener('click', () => {
    handleOreSort('quantity');
});

if (sortInventoryMaterialHeader) sortInventoryMaterialHeader.addEventListener('click', () => {
    handleInventorySort('material');
});

if (sortInventoryQualityHeader) sortInventoryQualityHeader.addEventListener('click', () => {
    handleInventorySort('quality');
});

if (sortInventoryQuantityHeader) sortInventoryQuantityHeader.addEventListener('click', () => {
    handleInventorySort('quantity');
});

if (sortInventoryLocationHeader) sortInventoryLocationHeader.addEventListener('click', () => {
    handleInventorySort('location');
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

function handleOreSort(column) {
    if (currentOreSortColumn === column) {
        currentOreSortOrder = currentOreSortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
        currentOreSortColumn = column;
        currentOreSortOrder = 'ASC';
    }
    
    updateOreSortIndicators();
    loadOreLocations();
}

function handleInventorySort(column) {
    if (currentInventorySortColumn === column) {
        currentInventorySortOrder = currentInventorySortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
        currentInventorySortColumn = column;
        currentInventorySortOrder = column === 'material' || column === 'location' ? 'ASC' : 'DESC';
    }
    
    updateInventorySortIndicators();
    loadInventory();
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

function updateOreSortIndicators() {
    const minerArrow = sortOreMinerHeader.querySelector('span');
    const materialArrow = sortOreMaterialHeader.querySelector('span');
    const locationArrow = sortOreLocationHeader.querySelector('span');
    const qualityArrow = sortOreQualityHeader.querySelector('span');
    const quantityArrow = sortOreQuantityHeader.querySelector('span');
    
    if (minerArrow) minerArrow.innerHTML = '&nbsp;';
    if (materialArrow) materialArrow.innerHTML = '&nbsp;';
    if (locationArrow) locationArrow.innerHTML = '&nbsp;';
    if (qualityArrow) qualityArrow.innerHTML = '&nbsp;';
    if (quantityArrow) quantityArrow.innerHTML = '&nbsp;';
    
    const indicator = currentOreSortOrder === 'ASC' ? '▲' : '▼';
    
    if (currentOreSortColumn === 'miner') {
        if (minerArrow) minerArrow.textContent = indicator;
    } else if (currentOreSortColumn === 'material') {
        if (materialArrow) materialArrow.textContent = indicator;
    } else if (currentOreSortColumn === 'location') {
        if (locationArrow) locationArrow.textContent = indicator;
    } else if (currentOreSortColumn === 'quality') {
        if (qualityArrow) qualityArrow.textContent = indicator;
    } else if (currentOreSortColumn === 'quantity') {
        if (quantityArrow) quantityArrow.textContent = indicator;
    }
}

function updateInventorySortIndicators() {
    const materialArrow = sortInventoryMaterialHeader.querySelector('span');
    const qualityArrow = sortInventoryQualityHeader.querySelector('span');
    const quantityArrow = sortInventoryQuantityHeader.querySelector('span');
    const locationArrow = sortInventoryLocationHeader.querySelector('span');
    
    if (materialArrow) materialArrow.innerHTML = '&nbsp;';
    if (qualityArrow) qualityArrow.innerHTML = '&nbsp;';
    if (quantityArrow) quantityArrow.innerHTML = '&nbsp;';
    if (locationArrow) locationArrow.innerHTML = '&nbsp;';
    
    const indicator = currentInventorySortOrder === 'ASC' ? '▲' : '▼';
    
    if (currentInventorySortColumn === 'material') {
        if (materialArrow) materialArrow.textContent = indicator;
    } else if (currentInventorySortColumn === 'quality') {
        if (qualityArrow) qualityArrow.textContent = indicator;
    } else if (currentInventorySortColumn === 'quantity') {
        if (quantityArrow) quantityArrow.textContent = indicator;
    } else if (currentInventorySortColumn === 'location') {
        if (locationArrow) locationArrow.textContent = indicator;
    }
}

if (fileInput) fileInput.addEventListener('change', (e) => {
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

async function loadMembers() {
    const members = await ipcRenderer.invoke('get-org-members');
    const myStatus = await ipcRenderer.invoke('get-setup-status');
    currentOrgUuid = myStatus.orgUuid;
    currentUserRole = myStatus.userRole;
    displayOrgUuid.textContent = `Org UUID: ${currentOrgUuid || '...'}`;

    pendingMembersBody.innerHTML = '';
    membersBody.innerHTML = '';
    
    let hasPending = false;
    const isCEO = currentUserRole === 'CEO' || currentUserRole === 'Admin';
    const isDirector = currentUserRole === 'Director';

    members.forEach(member => {
        const tr = document.createElement('tr');

        if (member.status === 'Pending') {
            hasPending = true;
            tr.innerHTML = `
                <td>${member.name}</td>
                <td><code style="font-size: 0.8em;">${member.uuid}</code></td>
                <td>
                    ${(isCEO || isDirector) ? `
                        <button onclick="acceptMember('${member.uuid}')">Accept</button>
                        <button class="danger" onclick="deleteMember('${member.uuid}')">Reject</button>
                    ` : ''}
                </td>
            `;
            pendingMembersBody.appendChild(tr);
        } else {
            const isMe = member.uuid === myStatus.localSyncUuid;
            const isTargetCEO = member.role === 'CEO' || member.role === 'Admin';
            
            let actions = '';
            // CEO can manage anyone who is not themselves.
            // Directors can only manage Members and Miners (not other Directors or CEOs).
            const isTargetDirector = member.role === 'Director';
            const canManage = !isMe && !isTargetCEO && (isCEO || (isDirector && !isTargetDirector));
            if (canManage) {
                actions = `<select onchange="updateMemberRole('${member.uuid}', this.value)" class="miner-select" style="width: 120px; margin-right: 10px;">`;

                if (isCEO) {
                    actions += `<option value="CEO" ${member.role === 'CEO' ? 'selected' : ''}>CEO</option>`;
                    actions += `<option value="Director" ${member.role === 'Director' ? 'selected' : ''}>Director</option>`;
                }

                actions += `<option value="Member" ${member.role === 'Member' ? 'selected' : ''}>Member</option>`;
                actions += `<option value="Miner" ${member.role === 'Miner' ? 'selected' : ''}>Miner</option>`;
                actions += `</select>`;
                actions += `<button class="danger" onclick="deleteMember('${member.uuid}')">Remove</button>`;
            }

            tr.innerHTML = `
                <td>${member.name} ${isMe ? '(You)' : ''}</td>
                <td><span class="role-badge role-${member.role.toLowerCase()}">${member.role}</span></td>
                <td><code style="font-size: 0.8em;">${member.uuid}</code></td>
                <td>${actions}</td>
            `;
            membersBody.appendChild(tr);
        }
    });

    pendingRequestsSection.style.display = (hasPending && (isCEO || isDirector)) ? 'block' : 'none';
}

window.acceptMember = async (uuid) => {
    await ipcRenderer.invoke('accept-member', uuid);
    loadMembers();
};

window.deleteMember = async (uuid) => {
    const confirmed = await showModal('Are you sure?', 'confirm', 'Confirm Action');
    if (confirmed) {
        await ipcRenderer.invoke('delete-member', uuid);
        loadMembers();
    }
};

window.updateMemberRole = async (uuid, role) => {
    if (role === 'CEO') {
        const confirmed = await showModal('Are you sure you want to transfer CEO ownership to this member? You will lose CEO permissions and become a regular Member.', 'confirm', 'Confirm CEO Transfer');
        if (!confirmed) {
            loadMembers(); // Refresh to reset select
            return;
        }
    }
    const result = await ipcRenderer.invoke('update-member-role', { uuid, role });
    if (result && role === 'CEO') {
        // If we transferred CEO, our role changed too
        const status = await ipcRenderer.invoke('get-setup-status');
        currentUserRole = status.userRole;
        applyPermissions();
    }
    loadMembers();
};

async function loadMiners() {
    let minersTableData = await ipcRenderer.invoke('get-miners');
    const members = await ipcRenderer.invoke('get-org-members');
    
    // Combine miners table names and members with mining-related roles
    const minerNames = new Set();
    const isStaff = currentUserRole === 'CEO' || currentUserRole === 'Admin' || currentUserRole === 'Director';
    
    minersTableData.forEach(m => {
        if (!m.is_deleted) {
            minerNames.add(m.name);
        }
    });

    members.forEach(member => {
        if (member.status === 'Accepted' && (member.role === 'Miner' || member.role === 'Director' || member.role === 'Admin' || member.role === 'CEO')) {
            minerNames.add(member.name);
        }
    });

    // Create unique miner list for dropdowns
    const dropdownMiners = Array.from(minerNames).map(name => ({ name }));
    
    // Sort so "None" is at the end
    dropdownMiners.sort((a, b) => {
        if (a.name === 'None') return 1;
        if (b.name === 'None') return -1;
        return a.name.localeCompare(b.name);
    });

    // Update dropdowns
    const dropdowns = [globalMinerSelect, editMinerSelect];
    dropdowns.forEach(select => {
        if (!select) {
            console.warn('Dropdown element missing, skipping population.');
            return;
        }
        let currentValue = select.value;
        select.innerHTML = '<option value="">Select a Miner...</option>';
        dropdownMiners.forEach(miner => {
            const option = document.createElement('option');
            option.value = miner.name;
            option.textContent = miner.name;
            select.appendChild(option);
        });

        // Try to restore previous selection
        if (currentValue) {
            select.value = currentValue;
        }
    });

    // Update miner management list (This still only shows the manually added miners table for management)
    minerBody.innerHTML = '';
    minersTableData.forEach(miner => {
        if (miner.is_deleted) return;
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

if (addMinerBtn) {
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
}

window.openMinerEditModal = (id, name) => {
    editMinerId.value = id;
    editMinerNameInput.value = name;
    minerEditModal.style.display = 'block';
};

if (minerModalCancelBtn) {
    minerModalCancelBtn.onclick = () => {
        minerEditModal.style.display = 'none';
    };
}

if (minerModalSaveBtn) {
    minerModalSaveBtn.onclick = async () => {
        const id = parseInt(editMinerId.value);
        const newName = editMinerNameInput.value.trim();
        if (!newName) {
            await showModal('Miner name cannot be empty.');
            return;
        }
        try {
            await ipcRenderer.invoke('update-miner', { id, name: newName });
            minerEditModal.style.display = 'none';
            minerStatus.textContent = 'Miner updated successfully.';
            await loadMiners();
            setTimeout(() => minerStatus.textContent = '', 3000);
        } catch (err) {
            await showModal('Error: ' + err.message);
        }
    };
}


window.deleteMiner = async (id) => {
    const confirmed = await showModal('Are you sure you want to delete this miner?', 'confirm', 'Delete Miner');
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
        
        const isCEO = currentUserRole === 'CEO' || currentUserRole === 'Admin';
        const isDirector = currentUserRole === 'Director';
        const isStaff = isCEO || isDirector;
        
        tr.innerHTML = `
            <td>${row.material}</td>
            <td>${displayQuality}</td>
            <td>${displayYield}</td>
            <td>
                ${isStaff ? `
                    <button onclick="openEditModal(${row.id}, '${row.material.replace(/'/g, "\\'")}', ${row.quality}, ${row.yield_cscu}, '${row.miner_name}', '${location.replace(/'/g, "\\'")}', true)">Edit</button>
                    <button class="danger" onclick="deleteYield(${row.id})">Delete</button>
                ` : '<span style="color: #888; font-style: italic;">View Only</span>'}
            </td>
        `;
        yieldBody.appendChild(tr);
    });
}

function switchView(view) {
    viewDashboard.classList.remove('active');
    viewMiningList.classList.remove('active');
    viewOreDetails.classList.remove('active');
    viewStatistics.classList.remove('active');
    viewMinerDetails.classList.remove('active');
    viewSync.classList.remove('active');
    viewOrders.classList.remove('active');
    viewCompletedOrders.classList.remove('active');
    viewOrderDetails.classList.remove('active');
    viewOreLocation.classList.remove('active');
    viewInventory.classList.remove('active');
    viewMembersList.classList.remove('active');

    if (view === 'dashboard') {
        viewDashboard.classList.add('active');
    } else if (view === 'mining') {
        viewMiningList.classList.add('active');
    } else if (view === 'miners') {
        viewMembersList.classList.add('active');
        loadMembers();
    } else if (view === 'statistics') {
        viewStatistics.classList.add('active');
        loadMinerStats();
    } else if (view === 'ore-location') {
        viewOreLocation.classList.add('active');
        loadOreLocations();
    } else if (view === 'inventory') {
        viewInventory.classList.add('active');
        loadInventory();
    } else if (view === 'sync') {
        viewSync.classList.add('active');
        loadSyncSettings();
    } else if (view === 'miner-details') {
        viewMinerDetails.classList.add('active');
    } else if (view === 'orders') {
        viewOrders.classList.add('active');
        loadOrders();
    } else if (view === 'completed-orders') {
        viewCompletedOrders.classList.add('active');
        loadCompletedOrders();
    } else if (view === 'order-details') {
        viewOrderDetails.classList.add('active');
    } else if (view === 'members') {
        viewMembersList.classList.add('active');
        loadMembers();
    } else {
        viewOreDetails.classList.add('active');
    }
}

async function refreshCurrentView() {
    if (viewOreDetails.classList.contains('active') && currentViewedLocation) {
        await loadLocationDetails(currentViewedLocation);
    } else if (viewStatistics.classList.contains('active')) {
        await loadMinerStats();
    } else if (viewOreLocation.classList.contains('active')) {
        await loadOreLocations();
    } else if (viewMinerDetails.classList.contains('active')) {
        await loadMinerDetails(currentMinerNameHeader.textContent);
    } else if (viewMembersList.classList.contains('active')) {
        await loadMembers();
    } else if (viewSync.classList.contains('active')) {
        await loadSyncSettings();
    } else if (viewOrders.classList.contains('active')) {
        await loadOrders();
    } else if (viewInventory.classList.contains('active')) {
        await loadInventory();
    } else if (viewCompletedOrders.classList.contains('active')) {
        await loadCompletedOrders();
    } else if (viewOrderDetails.classList.contains('active')) {
        // No auto-refresh for order details yet, or refresh if we have a currentOrderUuid
    } else {
        // No auto-refresh for default view (locations) if needed, but it's removed
    }
}

window.deleteYield = async (id) => {
    const confirmed = await showModal('Are you sure you want to delete this record?', 'confirm', 'Delete Record');
    if (confirmed) {
        await ipcRenderer.invoke('delete-yield', id);
        await refreshCurrentView();
    }
};

window.openEditModal = (id, material, quality, yield_cscu, miner_name, location, quantityOnly = false) => {
    editModal.dataset.isInventory = 'false';
    editModalTitle.textContent = 'Edit Record';
    editYieldLabel.textContent = 'Yield (cSCU):';

    editId.value = id;
    editMat.value = material;
    editQuality.value = Math.round(quality);
    editYield.value = Math.round(yield_cscu);
    editMinerSelect.value = (miner_name && miner_name !== 'Unknown') ? miner_name : '';
    editLocation.value = location || '';
    
    // Reset display of all rows
    editMatRow.style.display = 'block';
    editQualityRow.style.display = 'block';
    editYieldRow.style.display = 'block';
    editMinerRow.style.display = 'flex';
    editLocationRow.style.display = 'block';

    // If quantityOnly is true, disable other fields as per user request
    editMat.disabled = quantityOnly;
    editQuality.disabled = quantityOnly;
    editMinerSelect.disabled = quantityOnly;
    editLocation.disabled = quantityOnly;
    editYield.disabled = false;

    if (quantityOnly) {
        editMinerRow.style.display = 'none';
        editModal.dataset.quantityOnly = 'true';
    } else {
        editModal.dataset.quantityOnly = 'false';
    }
    
    editModal.style.display = 'block';
};

window.openInventoryEditModal = (id, material, quality, quantity, location) => {
    editModal.dataset.isInventory = 'true';
    editModalTitle.textContent = 'Edit Inventory';
    editYieldLabel.textContent = 'Quantity (cSCU):';
    
    editId.value = id;
    editMat.value = material;
    editQuality.value = Math.round(quality);
    editYield.value = Math.round(quantity);
    editLocation.value = location || '';
    
    // Show Material and Quality as disabled, hide Miner
    editMatRow.style.display = 'block';
    editMat.disabled = true;
    editQualityRow.style.display = 'block';
    editQuality.disabled = true;
    editYieldRow.style.display = 'block';
    editYield.disabled = false;
    editMinerRow.style.display = 'none';
    editLocationRow.style.display = 'block';
    editLocation.disabled = false;
    
    editModal.style.display = 'block';
};

modalCancelBtn.onclick = () => {
    editModal.style.display = 'none';
};

modalSaveBtn.onclick = async () => {
    const isInventory = editModal.dataset.isInventory === 'true';
    if (isInventory) {
        const id = parseInt(editId.value);
        const quantity = Math.round(parseFloat(editYield.value)) || 0;
        const location = editLocation.value.trim() || 'Unknown';
        
        if (isNaN(quantity) || quantity < 0) {
            await showModal('Quantity must be a positive number.');
            return;
        }
        
        await ipcRenderer.invoke('update-inventory', { id, quantity, location });
        await loadInventory();
        editModal.style.display = 'none';
        return;
    }

    const isQuantityOnly = editModal.dataset.quantityOnly === 'true';
    let miner_name = editMinerSelect.value;
    let location = editLocation.value.trim();
    
    if (isQuantityOnly) {
        miner_name = 'Aggregated';
    } else if (!miner_name) {
        await showModal('Please select a miner.');
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

if (manualAddBtn) manualAddBtn.addEventListener('click', async () => {
    console.log('Add Entry button clicked!');
    manualStatus.textContent = 'Processing...';
    
    const material = manualMat.value.trim();
    const qualityStr = manualQuality.value.trim();
    const yieldStr = manualYield.value.trim();
    
    const miner_name = globalMinerSelect.value;
    const location = globalLocationSelect.value.trim();

    console.log('Manual Entry Data:', { material, qualityStr, yieldStr, miner_name, location });

    // 1. Miner Validation
    if (!miner_name || miner_name === "") {
        manualStatus.textContent = 'Error: "Select a Miner..." hasn\'t been changed to an actual miner or None.';
        return;
    }

    // 2. Location Validation
    if (!location) {
        manualStatus.textContent = 'Error: No Active Location has been selected.';
        return;
    }

    // 3. Ore / Image Validation
    if (!material && !lastProcessedImagePath) {
        manualStatus.textContent = 'Error: No ore has been selected for Manual Entry and no image has been uploaded.';
        return;
    }
    
    if (!material) {
        manualStatus.textContent = 'Error: No ore has been selected for Manual Entry.';
        return;
    }

    // 4. Quality Validation
    if (!qualityStr) {
        manualStatus.textContent = 'Error: No Quality has been input for a Manual Entry.';
        return;
    }
    const quality = Math.round(parseFloat(qualityStr));
    if (isNaN(quality) || quality < 0 || quality > 999) {
        manualStatus.textContent = 'Error: Quality must be a number between 0 and 999.';
        return;
    }

    // 5. Quantity (Yield) Validation
    if (!yieldStr) {
        manualStatus.textContent = 'Error: No Quantity has been input for a Manual Entry.';
        return;
    }
    const yield_cscu = Math.round(parseFloat(yieldStr));
    if (isNaN(yield_cscu) || yield_cscu < 0) {
        manualStatus.textContent = 'Error: Yield must be a positive number.';
        return;
    }

    if (yield_cscu === 0) {
        manualStatus.innerHTML = '<span style="color: #ffaa00;">Warning: Yield is 0, this entry will be saved but might not show in some lists.</span>';
    } else {
        manualStatus.textContent = 'Saving...';
    }

    try {
        console.log('Invoking save-yield with data:', { material, quality, yield_cscu, miner_name, location });
        const result = await ipcRenderer.invoke('save-yield', { material, quality, yield_cscu, miner_name, location });
        console.log('Save result received:', result);
        
        const successMsg = `Success: Added ${material} (Q: ${quality}, Y: ${yield_cscu}) at ${location} for ${miner_name}`;
        if (yield_cscu === 0) {
            manualStatus.innerHTML = `<span style="color: #44ff44;">${successMsg}</span> <br><span style="color: #ffaa00;">(Reminder: 0 yield entries are hidden from the main list)</span>`;
        } else {
            manualStatus.textContent = successMsg;
        }
        
        // Reset form
        manualMat.value = '';
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
            await showModal('Please select a miner for all entries before saving.');
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
        
        const isCEO = currentUserRole === 'CEO' || currentUserRole === 'Admin';
        const isDirector = currentUserRole === 'Director';
        const isStaff = isCEO || isDirector;
        
        tr.innerHTML = `
            <td>${row.material}</td>
            <td>${displayQuality}</td>
            <td>${displayYield}</td>
            <td>${row.location || 'Unknown'}</td>
            <td>${timestamp}</td>
            <td>
                ${isStaff ? `
                    <button onclick="openEditModal(${row.id}, '${row.material.replace(/'/g, "\\'")}', ${row.quality}, ${row.yield_cscu}, '${minerName.replace(/'/g, "\\'")}', '${(row.location || 'Unknown').replace(/'/g, "\\'")}', false)">Edit</button>
                    <button class="danger" onclick="deleteYield(${row.id})">Delete</button>
                    <button class="btn-transfer" onclick="transferToInventory(${row.id})">To Inventory</button>
                ` : '<span style="color: #888; font-style: italic;">View Only</span>'}
            </td>
        `;
        minerDetailsBody.appendChild(tr);
    });
}

async function loadOreLocations() {
    const rows = await ipcRenderer.invoke('get-ore-locations-by-miner');
    
    // Sort logic in JS to handle grouping requirements
    const sortedRows = [...rows].sort((a, b) => {
        // Primary sort: Miner Name (to keep them grouped)
        const minerA = (a.miner_name || '').toLowerCase();
        const minerB = (b.miner_name || '').toLowerCase();
        
        // If the primary sort is Miner Name, we use the user's requested order
        // Otherwise, we use ASC to keep grouping consistent
        const primaryOrder = currentOreSortColumn === 'miner' ? (currentOreSortOrder === 'ASC' ? 1 : -1) : 1;
        
        if (minerA < minerB) return -1 * primaryOrder;
        if (minerA > minerB) return 1 * primaryOrder;
        
        // Secondary sort: Selected column (if not Miner Name)
        if (currentOreSortColumn !== 'miner') {
            const secondaryOrder = currentOreSortOrder === 'ASC' ? 1 : -1;
            let valA, valB;
            
            if (currentOreSortColumn === 'quality') {
                valA = a.quality || 0;
                valB = b.quality || 0;
            } else if (currentOreSortColumn === 'material') {
                valA = (a.material || '').toLowerCase();
                valB = (b.material || '').toLowerCase();
            } else if (currentOreSortColumn === 'location') {
                valA = (a.location || '').toLowerCase();
                valB = (b.location || '').toLowerCase();
            } else if (currentOreSortColumn === 'quantity') {
                valA = a.yield_cscu || 0;
                valB = b.yield_cscu || 0;
            }
            
            if (valA < valB) return -1 * secondaryOrder;
            if (valA > valB) return 1 * secondaryOrder;
        }
        
        // Tertiary sort: Timestamp (newest first)
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    oreLocationBody.innerHTML = '';
    sortedRows.forEach(row => {
        const tr = document.createElement('tr');
        const displayQuality = row.quality !== null ? Math.round(row.quality).toString().padStart(3, '0') : '000';
        const timestamp = new Date(row.timestamp).toLocaleString();
        
        const isCEO = currentUserRole === 'CEO' || currentUserRole === 'Admin';
        const isDirector = currentUserRole === 'Director';
        const isStaff = isCEO || isDirector;
        
        tr.innerHTML = `
            <td>${row.miner_name}</td>
            <td>${row.material}</td>
            <td>${row.location || 'Unknown'}</td>
            <td>${displayQuality}</td>
            <td>${Math.round(row.yield_cscu)}</td>
            <td>${timestamp}</td>
            <td>
                ${isStaff ? `<button onclick="transferToInventory(${row.id})">Transfer to Inventory</button>` : '<span style="color: #888; font-style: italic;">View Only</span>'}
            </td>
        `;
        oreLocationBody.appendChild(tr);
    });
}

if (navOrdersBtn) navOrdersBtn.addEventListener('click', () => {
    switchView('orders');
});

if (backToMiningFromOrders) backToMiningFromOrders.addEventListener('click', () => {
    switchView('mining');
});

if (backToOrdersFromCompleted) backToOrdersFromCompleted.addEventListener('click', () => {
    switchView('orders');
});

if (backToOrdersFromDetailsBtn) backToOrdersFromDetailsBtn.addEventListener('click', () => {
    switchView('orders');
});

if (navCompletedOrdersBtn) navCompletedOrdersBtn.addEventListener('click', () => {
    switchView('completed-orders');
});

if (submitOrderBtn) submitOrderBtn.addEventListener('click', async () => {
    const material = orderOreInput.value.trim();
    const quantity = parseFloat(orderQuantityInput.value);
    const min_quality = parseFloat(orderQualitySelect.value);

    if (!material || isNaN(quantity)) {
        orderSubmitStatus.textContent = 'Please fill in all fields.';
        orderSubmitStatus.style.color = '#ff4444';
        return;
    }

    const success = await ipcRenderer.invoke('add-order', { material, quantity, min_quality });
    if (success) {
        orderOreInput.value = '';
        orderQuantityInput.value = '';
        orderSubmitStatus.textContent = 'Order submitted successfully!';
        orderSubmitStatus.style.color = '#00ff00';
        loadOrders();
        setTimeout(() => { orderSubmitStatus.textContent = ''; }, 3000);
    } else {
        orderSubmitStatus.textContent = 'Failed to submit order.';
        orderSubmitStatus.style.color = '#ff4444';
    }
});

async function loadOrders() {
    const orders = await ipcRenderer.invoke('get-orders');
    ordersBody.innerHTML = '';
    
    // Only show Pending orders in the main orders list
    const pendingOrders = orders.filter(o => o.status === 'Pending');
    
    if (pendingOrders.length === 0) {
        ordersBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">No pending orders.</td></tr>';
        return;
    }

    const isCEO = currentUserRole === 'CEO' || currentUserRole === 'Admin';
    const isDirector = currentUserRole === 'Director';
    const isStaff = isCEO || isDirector;
    
    pendingOrders.forEach(order => {
        const tr = document.createElement('tr');
        tr.className = 'clickable-row';
        tr.onclick = () => showOrderDetails(order.uuid);
        const dateStr = new Date(order.created_at).toLocaleString();
        
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${order.material}</td>
            <td>${Math.round(order.quantity)}</td>
            <td>${Math.round(order.quantity_mined || 0)}</td>
            <td>${Math.round(order.min_quality)}</td>
            <td>
                ${isStaff ? `<button class="danger" onclick="event.stopPropagation(); deleteOrder('${order.uuid}')">Delete</button>` : ''}
            </td>
        `;
        ordersBody.appendChild(tr);
    });
}

async function loadCompletedOrders() {
    const orders = await ipcRenderer.invoke('get-orders');
    completedOrdersBody.innerHTML = '';
    
    // Only show Completed orders
    const completedOrders = orders.filter(o => o.status === 'Completed');
    
    if (completedOrders.length === 0) {
        completedOrdersBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">No completed orders.</td></tr>';
        return;
    }

    const isCEO = currentUserRole === 'CEO' || currentUserRole === 'Admin';
    const isDirector = currentUserRole === 'Director';
    const isStaff = isCEO || isDirector;

    completedOrders.forEach(order => {
        const tr = document.createElement('tr');
        tr.className = 'clickable-row';
        tr.onclick = () => showOrderDetails(order.uuid);
        const dateStr = new Date(order.created_at).toLocaleString();
        
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${order.material}</td>
            <td>${Math.round(order.quantity)}</td>
            <td>${Math.round(order.quantity_mined || 0)}</td>
            <td>${Math.round(order.min_quality)}</td>
            <td>
                ${isStaff ? `<button class="danger" onclick="event.stopPropagation(); deleteOrder('${order.uuid}')">Delete</button>` : ''}
            </td>
        `;
        completedOrdersBody.appendChild(tr);
    });
}

async function showOrderDetails(uuid) {
    const details = await ipcRenderer.invoke('get-order-details', uuid);
    if (!details) return;

    const { order, contributions } = details;
    
    switchView('order-details');
    orderDetailsTitle.textContent = `Order: ${order.material}`;
    
    orderSummaryDiv.innerHTML = `
        <p><strong>Quantity Rqd:</strong> ${Math.round(order.quantity)} | 
           <strong>Quantity Mined:</strong> ${Math.round(order.quantity_mined || 0)} | 
           <strong>Min Quality:</strong> ${Math.round(order.min_quality)}</p>
        <p><strong>Status:</strong> ${order.status}</p>
    `;

    orderContributionsBody.innerHTML = '';
    if (contributions.length === 0) {
        orderContributionsBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">No contributions recorded yet.</td></tr>';
    } else {
        contributions.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(c.timestamp).toLocaleString()}</td>
                <td>${c.miner_name}</td>
                <td>${c.material}</td>
                <td>${Math.round(c.quantity)}</td>
                <td>${Math.round(c.quality)}</td>
            `;
            orderContributionsBody.appendChild(tr);
        });
    }
}

window.updateOrderStatus = async (uuid, status) => {
    await ipcRenderer.invoke('update-order-status', { uuid, status });
    await refreshCurrentView();
};

window.deleteOrder = async (uuid) => {
    const confirmed = await showModal('Are you sure you want to delete this order?', 'confirm', 'Delete Order');
    if (confirmed) {
        await ipcRenderer.invoke('delete-order', uuid);
        await refreshCurrentView();
    }
};

async function loadInventory() {
    const inventory = await ipcRenderer.invoke('get-inventory', {
        column: currentInventorySortColumn,
        order: currentInventorySortOrder
    });
    inventoryBody.innerHTML = '';
    
    if (inventory.length === 0) {
        inventoryBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">Inventory is empty.</td></tr>';
        return;
    }

    const isCEO = currentUserRole === 'CEO' || currentUserRole === 'Admin';
    const isDirector = currentUserRole === 'Director';
    const isStaff = isCEO || isDirector;
    
    inventory.forEach(item => {
        const tr = document.createElement('tr');
        const displayQuality = item.quality !== null ? Math.round(item.quality).toString().padStart(3, '0') : '000';
        const displayQuantity = Math.round(item.quantity).toString();
        const displayLocation = item.location || 'Unknown';
        
        tr.innerHTML = `
            <td>${item.material}</td>
            <td>${displayQuality}</td>
            <td>${displayQuantity}</td>
            <td>${displayLocation}</td>
            <td>
                ${isStaff ? `
                    <button class="secondary" onclick="openInventoryEditModal(${item.id}, '${item.material.replace(/'/g, "\\'")}', ${item.quality}, ${item.quantity}, '${(item.location || 'Unknown').replace(/'/g, "\\'")}')">Edit</button>
                    <button class="danger" onclick="deleteInventory(${item.id})">Remove</button>
                ` : '<span style="color: #888; font-style: italic;">View Only</span>'}
            </td>
        `;
        inventoryBody.appendChild(tr);
    });
}

window.transferToInventory = async (yieldId) => {
    // Open the location selection modal instead of calling directly
    transferYieldId.value = yieldId;
    transferLocationInput.value = globalLocationSelect.value || ''; // Pre-fill with global location if set
    transferModal.style.display = 'block';
};

transferConfirmBtn.onclick = async () => {
    const yieldId = transferYieldId.value;
    const location = transferLocationInput.value.trim();
    
    if (!location) {
        await showModal('Please enter or select a location.');
        return;
    }

    try {
        await ipcRenderer.invoke('transfer-to-inventory', { yieldId, location });
        transferModal.style.display = 'none';
        await refreshCurrentView();
    } catch (err) {
        await showModal('Error transferring to inventory: ' + err.message);
    }
};

transferCancelBtn.onclick = () => {
    transferModal.style.display = 'none';
};

window.deleteInventory = async (id) => {
    const confirmed = await showModal('Are you sure you want to remove this item from inventory?', 'confirm', 'Delete Inventory Item');
    if (confirmed) {
        await ipcRenderer.invoke('delete-inventory', id);
        await loadInventory();
    }
};

checkSetup();
console.log('Renderer setup complete.');

// ============================================
// CONFIGURATION
// ============================================

// UPDATE THIS URL WITH YOUR NEW GOOGLE SCRIPT URL
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzYwrRL65hFpUeFb6nmg_QtKbY0zlknYeU_HQk4vC7bEFnQH-N9W679MDhYu1uUwul1Rw/exec';

// ============================================
// STATE MANAGEMENT
// ============================================

let STANDARD_MATRIX = {};
let PERSONNEL_MATRIX = {};
let LINES_MATRIX = [];
let palletCount = 0;
let selectedProduct = null;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    // Show loading indicator
    showLoading('Loading system...');
    
    // Load all matrices
    Promise.all([
        loadProductMatrix(),
        loadPersonnelMatrix(),
        loadLinesMatrix()
    ]).then(() => {
        hideLoading();
        console.log('✓ System ready');
        
        // Check for unsaved work after data is loaded
        checkSavedDraft();
    }).catch(error => {
        hideLoading();
        console.error('Error loading matrices:', error);
        // Even if error, try to restore draft
        checkSavedDraft();
    });
    
    // Default Dates
    document.getElementById('prodDate').valueAsDate = new Date();
    document.getElementById('checkDate').valueAsDate = new Date();
    
    // Setup Listeners
    setupDateValidation();
    setupAutoSave(); // Enable Auto-save
    
    // Prevent form default submission
    document.getElementById('qcForm').addEventListener('submit', function(e) {
        e.preventDefault();
    });
});

// ============================================
// 1. AUTO-SAVE & RECOVERY SYSTEM (New)
// ============================================

function setupAutoSave() {
    // Save on any input change in the form
    document.getElementById('qcForm').addEventListener('change', function() {
        saveDraft();
    });
    
    // Also save periodically every 30 seconds
    setInterval(saveDraft, 30000);
}

function saveDraft() {
    const draft = {
        timestamp: new Date().getTime(),
        section1: {
            checkDate: document.getElementById('checkDate').value,
            prodDate: document.getElementById('prodDate').value,
            expDate: document.getElementById('expDate').value,
            productItem: document.getElementById('productItem').value,
            shift: document.getElementById('shift').value,
            line: document.getElementById('line').value,
            group: document.getElementById('group').value
        },
        // We save the innerHTML of the table body to restore exact state
        tableHTML: document.getElementById('checkingTableBody').innerHTML,
        palletCount: palletCount
    };
    
    localStorage.setItem('qc_form_draft', JSON.stringify(draft));
    
    // Visual indicator
    const indicator = document.getElementById('draftStatus');
    if(indicator) {
        indicator.style.display = 'inline-block';
        indicator.innerHTML = '<i class="fas fa-check"></i> Draft Saved';
        setTimeout(() => { indicator.style.display = 'none'; }, 2000);
    }
}

function checkSavedDraft() {
    const saved = localStorage.getItem('qc_form_draft');
    if (!saved) {
        // No draft, start fresh with 1 row
        if (palletCount === 0) addPalletRow();
        return;
    }

    Swal.fire({
        title: 'Unsaved Draft Found',
        text: 'You have unsaved work from a previous session. Do you want to restore it?',
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: '#667eea',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Yes, Restore it',
        cancelButtonText: 'No, Start Fresh'
    }).then((result) => {
        if (result.isConfirmed) {
            restoreDraft(JSON.parse(saved));
        } else {
            localStorage.removeItem('qc_form_draft');
            addPalletRow();
        }
    });
}

function restoreDraft(draft) {
    // Restore Section 1
    document.getElementById('checkDate').value = draft.section1.checkDate;
    document.getElementById('prodDate').value = draft.section1.prodDate;
    document.getElementById('expDate').value = draft.section1.expDate;
    document.getElementById('shift').value = draft.section1.shift;
    document.getElementById('line').value = draft.section1.line;
    document.getElementById('group').value = draft.section1.group;
    
    // Restore Product & Standards
    const prodSelect = document.getElementById('productItem');
    prodSelect.value = draft.section1.productItem;
    if (prodSelect.value) {
        populateStandards(); // This refills the standard boxes
    }

    // Restore Table
    if (draft.tableHTML) {
        document.getElementById('checkingTableBody').innerHTML = draft.tableHTML;
        palletCount = draft.palletCount || 0;
        
        // Re-attach visual listeners to restored rows
        const rows = document.querySelectorAll('#checkingTableBody tr');
        rows.forEach(row => {
            const selects = row.querySelectorAll('select');
            selects.forEach(select => {
                // Re-apply visual alarm logic
                updateVisuals(select); 
            });
        });
    } else {
        addPalletRow();
    }
    
    Swal.fire({
        icon: 'success',
        title: 'Restored',
        text: 'Your previous session has been restored.',
        timer: 1500,
        showConfirmButton: false
    });
}

// ============================================
// 2. VISUAL ALARMS & UX (New)
// ============================================

function updateVisuals(element) {
    const row = element.closest('tr');
    
    if (element.value === 'NG') {
        // Highlight the input red
        element.classList.add('bg-danger');
        // Highlight the row yellow warning
        row.classList.add('table-warning-row');
    } else {
        // Remove red
        element.classList.remove('bg-danger');
        
        // Check if any other field in this row is still NG
        const hasNG = row.querySelector('.bg-danger');
        if (!hasNG) {
            row.classList.remove('table-warning-row');
        }
    }
}

// Quick "Set All OK" for a single row
function setRowOK(id) {
    const fields = ['boxPCode', 'boxContent', 'boxColor', 'sachetSeal', 'sachetPCode'];
    
    fields.forEach(field => {
        const el = document.getElementById(`${field}${id}`);
        if(el) {
            el.value = 'OK';
            updateVisuals(el);
        }
    });
    
    // Recalculate percent
    calculatePercentOK(id);
}

// ============================================
// 3. CORE LOGIC (Matrices & Data)
// ============================================

function loadProductMatrix() {
    return fetch(GOOGLE_SCRIPT_URL + '?action=getMatrix')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                STANDARD_MATRIX = data.matrix;
                populateProductDropdown();
            }
        }).catch(err => {
            console.error(err);
            useFallbackMatrix(); // Fallback if offline
            populateProductDropdown();
        });
}

function loadPersonnelMatrix() {
    return fetch(GOOGLE_SCRIPT_URL + '?action=getPersonnel')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                PERSONNEL_MATRIX = data.personnel;
                populatePersonnelDropdowns();
            }
        }).catch(() => {
            useFallbackPersonnel();
            populatePersonnelDropdowns();
        });
}

function loadLinesMatrix() {
    return fetch(GOOGLE_SCRIPT_URL + '?action=getLines')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                LINES_MATRIX = data.lines;
                updateLineDatalist();
            }
        });
}

// ============================================
// 4. SMART DATES & STANDARDS
// ============================================

function populateStandards() {
    const product = document.getElementById('productItem').value;
    selectedProduct = product;
    
    if (product && STANDARD_MATRIX[product]) {
        const std = STANDARD_MATRIX[product];
        
        document.getElementById('stdBoxPCode').value = std.box.pCode;
        document.getElementById('stdBoxContent').value = std.box.content;
        document.getElementById('stdBoxColor').value = std.box.color;
        document.getElementById('stdSachetSeal').value = std.sachet.seal;
        document.getElementById('stdSachetPCode').value = std.sachet.pCode;
        
        // Trigger Date Calculation
        validateDates();
        
    } else {
        // Clear standards
        ['stdBoxPCode','stdBoxContent','stdBoxColor','stdSachetPCode'].forEach(id => {
            document.getElementById(id).value = '';
        });
        document.getElementById('stdSachetSeal').value = '0%';
    }
}

function setupDateValidation() {
    // When production date changes, auto-calculate Expiry
    document.getElementById('prodDate').addEventListener('change', function() {
        const product = document.getElementById('productItem').value;
        const prodDateVal = this.value;

        if (product && STANDARD_MATRIX[product] && prodDateVal) {
            const shelfLife = STANDARD_MATRIX[product].shelfLifeDays;
            const prodDate = new Date(prodDateVal);
            
            // Calculate Expiry: Prod Date + Shelf Life
            const expDate = new Date(prodDate);
            expDate.setDate(expDate.getDate() + shelfLife);
            
            // Set Value
            document.getElementById('expDate').value = expDate.toISOString().split('T')[0];
            
            // Visual feedback
            const helpText = document.getElementById('expDateHelp');
            helpText.innerHTML = `<i class="fas fa-check-circle text-success"></i> Auto-set to ${shelfLife} days shelf life`;
        }
    });
}

function validateDates() {
    // Manual validation remains as a backup
    const product = document.getElementById('productItem').value;
    if (!product || !STANDARD_MATRIX[product]) return;
    
    // (Logic encapsulated in the listener above for better UX)
}

// ============================================
// 5. PALLET ROW MANAGEMENT
// ============================================

function addPalletRow() {
    palletCount++;
    const tbody = document.getElementById('checkingTableBody');
    
    const now = new Date();
    const timeString = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');

    const row = document.createElement('tr');
    row.id = `palletRow${palletCount}`;
    
    // Note the added onchange events for visual updates and the new Quick OK button
    row.innerHTML = `
        <td class="text-center">
            <input type="number" class="form-control form-control-sm text-center" id="noPallet${palletCount}" value="${palletCount}" readonly>
        </td>
        <td>
            <input type="time" class="form-control form-control-sm" id="time${palletCount}" value="${timeString}">
        </td>
        <td>
            <input type="number" class="form-control form-control-sm" id="totalCheck${palletCount}" placeholder="Qty" onchange="calculatePercentOK(${palletCount})">
        </td>
        <td>
            <select class="form-select form-select-sm" id="boxPCode${palletCount}" onchange="updateVisuals(this); calculatePercentOK(${palletCount})">
                <option value="">-</option><option value="OK">OK</option><option value="NG">NG</option>
            </select>
        </td>
        <td>
            <select class="form-select form-select-sm" id="boxContent${palletCount}" onchange="updateVisuals(this); calculatePercentOK(${palletCount})">
                <option value="">-</option><option value="OK">OK</option><option value="NG">NG</option>
            </select>
        </td>
        <td>
            <select class="form-select form-select-sm" id="boxColor${palletCount}" onchange="updateVisuals(this); calculatePercentOK(${palletCount})">
                <option value="">-</option><option value="OK">OK</option><option value="NG">NG</option>
            </select>
        </td>
        <td>
            <select class="form-select form-select-sm" id="sachetSeal${palletCount}" onchange="updateVisuals(this); calculatePercentOK(${palletCount})">
                <option value="">-</option><option value="OK">OK</option><option value="NG">NG</option>
            </select>
        </td>
        <td>
            <select class="form-select form-select-sm" id="sachetPCode${palletCount}" onchange="updateVisuals(this); calculatePercentOK(${palletCount})">
                <option value="">-</option><option value="OK">OK</option><option value="NG">NG</option>
            </select>
        </td>
        <td>
            <input type="text" class="form-control form-control-sm percent-ok text-center" id="percentOK${palletCount}" readonly>
        </td>
        <td>
            <textarea class="form-control form-control-sm" id="notes${palletCount}" rows="1" placeholder="Notes..."></textarea>
        </td>
        <td class="text-center">
            <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-outline-success" onclick="setRowOK(${palletCount})" title="All OK">
                    <i class="fas fa-check-double"></i>
                </button>
                <button type="button" class="btn btn-outline-danger" onclick="removePalletRow(${palletCount})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </td>
    `;
    
    tbody.appendChild(row);
    
    // Scroll to bottom of table
    const wrapper = document.querySelector('.table-wrapper');
    if(wrapper) wrapper.scrollTop = wrapper.scrollHeight;
    
    saveDraft(); // Save state
}

function removePalletRow(rowId) {
    const row = document.getElementById(`palletRow${rowId}`);
    if (row) {
        row.remove();
        saveDraft();
    }
}

function calculatePercentOK(rowId) {
    const totalCheck = parseInt(document.getElementById(`totalCheck${rowId}`).value) || 0;
    
    // Get all 5 check values
    const checks = [
        `boxPCode${rowId}`, `boxContent${rowId}`, `boxColor${rowId}`, 
        `sachetSeal${rowId}`, `sachetPCode${rowId}`
    ];
    
    let okCount = 0;
    let filledCount = 0;
    
    checks.forEach(id => {
        const val = document.getElementById(id).value;
        if(val !== '') filledCount++;
        if(val === 'OK') okCount++;
    });
    
    // Only calculate if all fields are filled to avoid partial % confusion
    if (filledCount > 0) {
        const percent = ((okCount / 5) * 100).toFixed(0); // 5 items to check per row
        const pInput = document.getElementById(`percentOK${rowId}`);
        pInput.value = percent + '%';
        
        // Visual for percentage
        if(percent < 100) {
            pInput.style.color = 'red';
            pInput.style.fontWeight = 'bold';
        } else {
            pInput.style.color = 'green';
        }
    }
}

// ============================================
// 6. SUBMISSION
// ============================================

function submitForm() {
    // Validate
    const form = document.getElementById('qcForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    
    // Check if table has rows
    if (document.querySelectorAll('#checkingTableBody tr').length === 0) {
        Swal.fire('Error', 'Please add at least one pallet check.', 'error');
        return;
    }

    // Prepare Data
    const formData = {
        formNumber: generateFormNumber(),
        checkDate: document.getElementById('checkDate').value,
        prodDate: document.getElementById('prodDate').value,
        expDate: document.getElementById('expDate').value,
        shift: document.getElementById('shift').value,
        productItem: document.getElementById('productItem').value,
        line: document.getElementById('line').value,
        group: document.getElementById('group').value,
        qcPersonnel: document.getElementById('qcPersonnel').value,
        shiftSupervisor: document.getElementById('shiftSupervisor').value,
        supervisor: document.getElementById('supervisor').value,
        sectionManager: document.getElementById('sectionManager').value,
        
        // Standards Snapshot
        itemCode: selectedProduct ? STANDARD_MATRIX[selectedProduct].itemCode : '',
        
        // Pallet Data
        palletChecks: []
    };
    
    // Scrape Table Data
    const rows = document.querySelectorAll('#checkingTableBody tr');
    rows.forEach(row => {
        const id = row.id.replace('palletRow', '');
        formData.palletChecks.push({
            noPallet: document.getElementById(`noPallet${id}`).value,
            time: document.getElementById(`time${id}`).value,
            totalCheck: document.getElementById(`totalCheck${id}`).value,
            boxPCode: document.getElementById(`boxPCode${id}`).value,
            boxContent: document.getElementById(`boxContent${id}`).value,
            boxColor: document.getElementById(`boxColor${id}`).value,
            sachetSeal: document.getElementById(`sachetSeal${id}`).value,
            sachetPCode: document.getElementById(`sachetPCode${id}`).value,
            percentOK: document.getElementById(`percentOK${id}`).value,
            notes: document.getElementById(`notes${id}`).value
        });
    });

    // Send
    showLoading('Submitting...');
    
    fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    })
    .then(() => {
        hideLoading();
        // Clear Draft on Success
        localStorage.removeItem('qc_form_draft');
        
        Swal.fire({
            icon: 'success',
            title: 'Submitted!',
            text: `Form ${formData.formNumber} saved successfully.`
        }).then(() => {
            // Reset logic
            document.getElementById('checkingTableBody').innerHTML = '';
            palletCount = 0;
            document.getElementById('qcForm').reset();
            document.getElementById('checkDate').valueAsDate = new Date();
            document.getElementById('prodDate').valueAsDate = new Date();
            addPalletRow();
        });
    })
    .catch(err => {
        hideLoading();
        Swal.fire('Error', 'Connection failed. Data is safe in draft. Try again.', 'error');
    });
}

function generateFormNumber() {
    // Simple ID generation based on timestamp
    return 'QC-' + Date.now().toString().slice(-8);
}

// Helpers
function showLoading(msg) { 
    document.getElementById('loadingSpinner').classList.add('active'); 
}
function hideLoading() { 
    document.getElementById('loadingSpinner').classList.remove('active'); 
}

// Fallback Data Functions (in case sheet is offline)
function populateProductDropdown() {
    const select = document.getElementById('productItem');
    select.innerHTML = '<option value="">-- Select Product --</option>';
    Object.keys(STANDARD_MATRIX).forEach(k => {
        const opt = document.createElement('option');
        opt.value = k; opt.text = k;
        select.appendChild(opt);
    });
}
function populatePersonnelDropdowns() {
    const populate = (id, list) => {
        const sel = document.getElementById(id);
        sel.innerHTML = `<option value="">-- Select ${id} --</option>`;
        list.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item; opt.text = item;
            sel.appendChild(opt);
        });
    };
    if(PERSONNEL_MATRIX.qcPersonnel) populate('qcPersonnel', PERSONNEL_MATRIX.qcPersonnel);
    if(PERSONNEL_MATRIX.shiftSupervisor) populate('shiftSupervisor', PERSONNEL_MATRIX.shiftSupervisor);
    if(PERSONNEL_MATRIX.supervisor) populate('supervisor', PERSONNEL_MATRIX.supervisor);
    if(PERSONNEL_MATRIX.sectionManager) populate('sectionManager', PERSONNEL_MATRIX.sectionManager);
}
function updateLineDatalist() {
    const dl = document.getElementById('lineDatalist');
    dl.innerHTML = '';
    LINES_MATRIX.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.name;
        dl.appendChild(opt);
    });
}
// Dummy Fallbacks
function useFallbackMatrix() {
    STANDARD_MATRIX = {
        'Candy Apple': { itemCode: 'CA01', shelfLifeDays: 365, box: {pCode:'CA-BOX', content:'24', color:'Red'}, sachet: {seal:'0%', pCode:'CA-SCH'} },
        'Mint Fresh': { itemCode: 'MF01', shelfLifeDays: 720, box: {pCode:'MF-BOX', content:'50', color:'Green'}, sachet: {seal:'0%', pCode:'MF-SCH'} }
    };
}
function useFallbackPersonnel() {
    PERSONNEL_MATRIX = { qcPersonnel: ['Admin'], shiftSupervisor: ['Admin'], supervisor: ['Admin'], sectionManager: ['Admin'] };
}
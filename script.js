/**
 * Iskolai Órarend - Frontend JavaScript
 */

// ===========================
// Konfiguráció
// ===========================

const API_URL = window.location.origin;

const ROLES = {
    admin: ['vezetoseg', 'rendszergaza'],
    editor: ['vezetoseg', 'rendszergaza', 'tanarok', 'irodistak'],
    viewer: ['tanulo']
};

const ROLE_NAMES = {
    vezetoseg: { name: 'Vezetőség', color: '#e74c3c' },
    rendszergaza: { name: 'Rendszergazda', color: '#9b59b6' },
    tanarok: { name: 'Tanár', color: '#27ae60' },
    irodistak: { name: 'Irodista', color: '#f39c12' },
    tanulo: { name: 'Tanuló', color: '#3498db' }
};

const DAYS = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek'];

const TOKEN_EXPIRY = 6 * 30 * 24 * 60 * 60 * 1000; // 6 hónap

// ===========================
// Állapot
// ===========================

let currentUser = null;
let authToken = null;
let currentView = 'class';
let selectedItem = null;
let editMode = false;

// Cache
let classesCache = [];
let teachersCache = [];
let roomsCache = [];
let subjectsCache = [];
let periodsCache = [];
let currentTimetable = [];

// ===========================
// Autentikáció
// ===========================

async function authenticateLDAP(username, password) {
    try {
        const response = await fetch(`${API_URL}/api/ldap/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        
        if (response.ok && data.success) {
            return {
                success: true,
                user: data.user,
                groups: data.groups,
                token: data.token
            };
        }
        
        return { success: false, error: data.error || 'Sikertelen bejelentkezés' };
    } catch (error) {
        console.error('[AUTH] Hiba:', error);
        return { success: false, error: 'Nem sikerült kapcsolódni a szerverhez' };
    }
}

async function validateToken(token, username) {
    try {
        const response = await fetch(`${API_URL}/api/auth/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, username })
        });

        if (response.ok) {
            const data = await response.json();
            return data;
        }
        return { valid: false };
    } catch (error) {
        console.error('[AUTH] Token validálási hiba:', error);
        return { valid: false };
    }
}

function saveSession(user, groups, token) {
    const session = {
        user,
        groups,
        token,
        expiry: Date.now() + TOKEN_EXPIRY,
        savedAt: new Date().toISOString()
    };
    localStorage.setItem('timetableSession', JSON.stringify(session));
}

function loadSession() {
    try {
        const saved = localStorage.getItem('timetableSession');
        if (!saved) return null;
        
        const session = JSON.parse(saved);
        if (session.expiry && Date.now() > session.expiry) {
            localStorage.removeItem('timetableSession');
            return null;
        }
        return session;
    } catch (e) {
        return null;
    }
}

function clearSession() {
    localStorage.removeItem('timetableSession');
    currentUser = null;
    authToken = null;
}

function hasPermission(allowedRoles) {
    if (!currentUser || !currentUser.groups) return false;
    return currentUser.groups.some(g => allowedRoles.includes(g.toLowerCase()));
}

function canEdit() {
    return hasPermission(ROLES.editor);
}

function isAdmin() {
    return hasPermission(ROLES.admin);
}

// ===========================
// UI Kezelés
// ===========================

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');
    const loginBtn = document.querySelector('.login-btn');
    
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Bejelentkezés...';
    loginBtn.disabled = true;
    errorDiv.textContent = '';
    
    const result = await authenticateLDAP(username, password);
    
    if (result.success) {
        currentUser = { ...result.user, groups: result.groups };
        authToken = result.token;
        saveSession(result.user, result.groups, result.token);
        showDashboard();
    } else {
        errorDiv.textContent = result.error;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Bejelentkezés';
        loginBtn.disabled = false;
    }
}

function handleLogout() {
    clearSession();
    document.getElementById('login-container').style.display = 'flex';
    document.getElementById('main-container').style.display = 'none';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('login-error').textContent = '';
}

async function checkSession() {
    const session = loadSession();
    
    if (session) {
        const validation = await validateToken(session.token, session.user.username);
        
        if (validation.valid) {
            currentUser = { ...session.user, groups: session.groups };
            authToken = session.token;
            showDashboard();
            return;
        }
        
        clearSession();
    }
    
    document.getElementById('login-container').style.display = 'flex';
}

async function showDashboard() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('main-container').style.display = 'flex';
    
    // Felhasználó adatok
    document.getElementById('user-display').textContent = currentUser.displayName || currentUser.username;
    
    const roleEl = document.getElementById('user-role');
    const primaryGroup = currentUser.groups[0]?.toLowerCase();
    const roleInfo = ROLE_NAMES[primaryGroup];
    
    if (roleInfo) {
        roleEl.textContent = roleInfo.name;
        roleEl.style.backgroundColor = roleInfo.color;
    } else {
        roleEl.textContent = primaryGroup || 'Felhasználó';
        roleEl.style.backgroundColor = '#95a5a6';
    }
    
    // Jogosultságok szerinti UI
    setupPermissions();
    
    // Adatok betöltése
    await loadAllData();
    
    // Alapértelmezett nézet
    switchView('class');
}

function setupPermissions() {
    // Admin tab láthatósága
    const adminNav = document.querySelector('[data-view="admin"]');
    if (adminNav) {
        adminNav.style.display = isAdmin() ? 'flex' : 'none';
    }
    
    // Szerkesztés gomb
    const editBtn = document.getElementById('edit-mode-btn');
    if (editBtn) {
        editBtn.style.display = canEdit() ? 'flex' : 'none';
    }
}

// ===========================
// Adatok betöltése
// ===========================

async function loadAllData() {
    try {
        const [classes, teachers, rooms, subjects, periods] = await Promise.all([
            fetchAPI('/api/classes'),
            fetchAPI('/api/teachers'),
            fetchAPI('/api/rooms'),
            fetchAPI('/api/subjects'),
            fetchAPI('/api/periods')
        ]);
        
        classesCache = classes || [];
        teachersCache = teachers || [];
        roomsCache = rooms || [];
        subjectsCache = subjects || [];
        periodsCache = periods || [];
        
        console.log('[DATA] Adatok betöltve');
    } catch (error) {
        console.error('[DATA] Betöltési hiba:', error);
        showToast('Hiba történt az adatok betöltésekor', 'error');
    }
}

async function fetchAPI(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'API hiba');
    }
    
    return response.json();
}

// ===========================
// Nézet váltás
// ===========================

function switchView(view) {
    currentView = view;
    selectedItem = null;
    editMode = false;
    
    // Nav gombok
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    // Admin szekció kezelése
    const adminSection = document.getElementById('admin-section');
    const mainContent = document.querySelector('.main-content');
    
    if (view === 'admin') {
        adminSection.style.display = 'block';
        mainContent.style.display = 'none';
        loadAdminData();
        return;
    }
    
    adminSection.style.display = 'none';
    mainContent.style.display = 'flex';
    
    // Selector címek
    const titles = {
        class: 'Osztályok',
        teacher: 'Tanárok',
        room: 'Termek'
    };
    
    document.getElementById('selector-title').textContent = titles[view];
    document.getElementById('view-subtitle').textContent = `${titles[view]} órarendje`;
    
    // Lista betöltése
    loadSelectorList();
    
    // Órarend elrejtése
    document.getElementById('timetable').style.display = 'none';
    document.getElementById('timetable-placeholder').style.display = 'flex';
    document.getElementById('timetable-title').textContent = 'Válassz elemet az órarend megtekintéséhez';
}

function loadSelectorList() {
    const list = document.getElementById('selector-list');
    const search = document.getElementById('selector-search').value.toLowerCase();
    
    let items = [];
    
    switch (currentView) {
        case 'class':
            items = classesCache.map(c => ({
                id: c.id,
                name: c.name,
                detail: `${c.studentCount || 0} tanuló`,
                icon: c.name
            }));
            break;
        case 'teacher':
            items = teachersCache.map(t => ({
                id: t.id,
                name: t.name,
                detail: t.subjects || '',
                icon: t.shortName || t.name.substring(0, 2)
            }));
            break;
        case 'room':
            items = roomsCache.map(r => ({
                id: r.id,
                name: r.name,
                detail: `${r.building || ''} épület, ${r.capacity || 0} fő`,
                icon: r.name
            }));
            break;
    }
    
    // Szűrés
    if (search) {
        items = items.filter(item => 
            item.name.toLowerCase().includes(search) ||
            item.detail.toLowerCase().includes(search)
        );
    }
    
    list.innerHTML = items.map(item => `
        <div class="selector-item ${selectedItem === item.id ? 'active' : ''}" 
             data-id="${item.id}" 
             onclick="selectItem('${item.id}')">
            <div class="item-icon">${item.icon.substring(0, 3)}</div>
            <div class="item-info">
                <div class="item-name">${item.name}</div>
                <div class="item-detail">${item.detail}</div>
            </div>
        </div>
    `).join('');
}

async function selectItem(id) {
    selectedItem = id;
    
    // Aktív elem jelölése
    document.querySelectorAll('.selector-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
    });
    
    // Órarend betöltése
    await loadTimetable();
}

// ===========================
// Órarend kezelés
// ===========================

async function loadTimetable() {
    if (!selectedItem) return;
    
    try {
        let endpoint;
        let title;
        
        switch (currentView) {
            case 'class':
                endpoint = `/api/timetable/class/${selectedItem}`;
                const cls = classesCache.find(c => c.id === selectedItem);
                title = `${cls?.name || ''} osztály órarendje`;
                break;
            case 'teacher':
                endpoint = `/api/timetable/teacher/${selectedItem}`;
                const teacher = teachersCache.find(t => t.id === selectedItem);
                title = `${teacher?.name || ''} órarendje`;
                break;
            case 'room':
                endpoint = `/api/timetable/room/${selectedItem}`;
                const room = roomsCache.find(r => r.id === selectedItem);
                title = `${room?.name || ''} terem órarendje`;
                break;
        }
        
        currentTimetable = await fetchAPI(endpoint);
        
        document.getElementById('timetable-title').textContent = title;
        document.getElementById('timetable').style.display = 'table';
        document.getElementById('timetable-placeholder').style.display = 'none';
        
        renderTimetable();
    } catch (error) {
        console.error('[TIMETABLE] Betöltési hiba:', error);
        showToast('Hiba az órarend betöltésekor', 'error');
    }
}

function renderTimetable() {
    const tbody = document.getElementById('timetable-body');
    
    let html = '';
    
    periodsCache.forEach(period => {
        html += `<tr>`;
        
        // Óra szám és időpont
        html += `
            <td class="time-cell">
                <div class="period-number">${period.number}.</div>
                <div class="period-time">${period.startTime} - ${period.endTime}</div>
            </td>
        `;
        
        // Napok
        for (let day = 1; day <= 5; day++) {
            const lessons = currentTimetable.filter(l => 
                l.dayOfWeek === day && l.periodId === period.id
            );
            
            if (lessons.length > 0) {
                const lesson = lessons[0];
                const color = lesson.subjectColor || '#3498db';
                
                html += `
                    <td>
                        <div class="lesson-cell" 
                             style="background: ${color}"
                             onclick="openLessonModal(${day}, '${period.id}', '${lesson.id}')"
                             title="${lesson.subjectName}">
                            <div class="subject-name">${lesson.subjectShortName || lesson.subjectName}</div>
                            <div class="teacher-name">${lesson.teacherShortName || lesson.teacherName}</div>
                            <div class="room-name">${lesson.roomName}</div>
                            ${lesson.note ? `<div class="lesson-note">${lesson.note}</div>` : ''}
                        </div>
                    </td>
                `;
            } else {
                html += `
                    <td class="empty-cell ${editMode ? 'edit-mode' : ''}" 
                        ${editMode && canEdit() ? `onclick="openLessonModal(${day}, '${period.id}')"` : ''}>
                    </td>
                `;
            }
        }
        
        html += `</tr>`;
    });
    
    tbody.innerHTML = html;
}

function toggleEditMode() {
    if (!canEdit()) return;
    
    editMode = !editMode;
    
    const btn = document.getElementById('edit-mode-btn');
    btn.classList.toggle('active', editMode);
    btn.innerHTML = editMode 
        ? '<i class="fas fa-check"></i><span>Kész</span>'
        : '<i class="fas fa-edit"></i><span>Szerkesztés</span>';
    
    renderTimetable();
    
    if (editMode) {
        showToast('Szerkesztési mód bekapcsolva', 'info');
    }
}

// ===========================
// Óra Modal
// ===========================

function openLessonModal(day, periodId, lessonId = null) {
    if (!canEdit() && lessonId) {
        // Csak megtekintés
        return;
    }
    
    if (!canEdit()) {
        return;
    }
    
    const modal = document.getElementById('lesson-modal');
    const form = document.getElementById('lesson-form');
    const title = document.getElementById('lesson-modal-title');
    const deleteBtn = document.getElementById('delete-lesson-btn');
    
    // Form reset
    form.reset();
    document.getElementById('lesson-id').value = lessonId || '';
    document.getElementById('lesson-day').value = day;
    document.getElementById('lesson-period').value = periodId;
    
    // Dropdown feltöltés
    populateLessonSelects();
    
    if (lessonId) {
        // Szerkesztés
        title.textContent = 'Óra szerkesztése';
        deleteBtn.style.display = 'block';
        
        const lesson = currentTimetable.find(l => l.id === lessonId);
        if (lesson) {
            document.getElementById('lesson-subject').value = lesson.subjectId;
            document.getElementById('lesson-teacher').value = lesson.teacherId;
            document.getElementById('lesson-room').value = lesson.roomId;
            document.getElementById('lesson-note').value = lesson.note || '';
        }
    } else {
        // Új óra
        title.textContent = 'Új óra hozzáadása';
        deleteBtn.style.display = 'none';
    }
    
    modal.classList.add('active');
}

function populateLessonSelects() {
    // Tantárgyak
    const subjectSelect = document.getElementById('lesson-subject');
    subjectSelect.innerHTML = '<option value="">Válassz tantárgyat...</option>' +
        subjectsCache.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    
    // Tanárok
    const teacherSelect = document.getElementById('lesson-teacher');
    teacherSelect.innerHTML = '<option value="">Válassz tanárt...</option>' +
        teachersCache.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    
    // Termek
    const roomSelect = document.getElementById('lesson-room');
    roomSelect.innerHTML = '<option value="">Válassz termet...</option>' +
        roomsCache.map(r => `<option value="${r.id}">${r.name} (${r.building || '-'} ép.)</option>`).join('');
}

async function handleLessonSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('lesson-id').value;
    const data = {
        dayOfWeek: parseInt(document.getElementById('lesson-day').value),
        periodId: document.getElementById('lesson-period').value,
        classId: currentView === 'class' ? selectedItem : null,
        subjectId: document.getElementById('lesson-subject').value,
        teacherId: document.getElementById('lesson-teacher').value,
        roomId: document.getElementById('lesson-room').value,
        note: document.getElementById('lesson-note').value
    };
    
    // Ha nem osztály nézetben vagyunk, ki kell választani az osztályt
    if (currentView !== 'class') {
        // TODO: Osztály választó hozzáadása
        showToast('Kérlek válts osztály nézetre az óra hozzáadásához', 'warning');
        return;
    }
    
    try {
        if (id) {
            await fetchAPI(`/api/timetable/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('Óra sikeresen módosítva', 'success');
        } else {
            await fetchAPI('/api/timetable', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('Óra sikeresen hozzáadva', 'success');
        }
        
        closeModal('lesson-modal');
        await loadTimetable();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteLesson() {
    const id = document.getElementById('lesson-id').value;
    if (!id) return;
    
    if (!confirm('Biztosan törölni szeretnéd ezt az órát?')) return;
    
    try {
        await fetchAPI(`/api/timetable/${id}`, { method: 'DELETE' });
        showToast('Óra törölve', 'success');
        closeModal('lesson-modal');
        await loadTimetable();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===========================
// Admin kezelés
// ===========================

function loadAdminData() {
    loadSubjectsList();
    loadTeachersList();
    loadClassesList();
    loadRoomsList();
    loadPeriodsList();
}

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.adminTab === tab);
    });
    
    document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `admin-${tab}`);
    });
}

// Tantárgyak
function loadSubjectsList() {
    const list = document.getElementById('subjects-list');
    list.innerHTML = subjectsCache.map(s => `
        <div class="admin-item">
            <div class="item-color" style="background: ${s.color}"></div>
            <div class="item-content">
                <div class="item-title">${s.name}</div>
                <div class="item-subtitle">${s.shortName || '-'}</div>
            </div>
            <div class="item-actions">
                <button class="edit-btn" onclick="editSubject('${s.id}')" title="Szerkesztés">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="delete-btn" onclick="deleteSubject('${s.id}')" title="Törlés">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function showSubjectModal(id = null) {
    const modal = document.getElementById('subject-modal');
    const form = document.getElementById('subject-form');
    const title = document.getElementById('subject-modal-title');
    
    form.reset();
    document.getElementById('subject-id').value = id || '';
    
    if (id) {
        title.textContent = 'Tantárgy szerkesztése';
        const subject = subjectsCache.find(s => s.id === id);
        if (subject) {
            document.getElementById('subject-name').value = subject.name;
            document.getElementById('subject-shortname').value = subject.shortName || '';
            document.getElementById('subject-color').value = subject.color || '#3498db';
        }
    } else {
        title.textContent = 'Új tantárgy';
        document.getElementById('subject-color').value = '#3498db';
    }
    
    modal.classList.add('active');
}

function editSubject(id) {
    showSubjectModal(id);
}

async function handleSubjectSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('subject-id').value;
    const data = {
        name: document.getElementById('subject-name').value,
        shortName: document.getElementById('subject-shortname').value,
        color: document.getElementById('subject-color').value
    };
    
    try {
        if (id) {
            await fetchAPI(`/api/subjects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        } else {
            await fetchAPI('/api/subjects', { method: 'POST', body: JSON.stringify(data) });
        }
        
        await loadAllData();
        loadSubjectsList();
        closeModal('subject-modal');
        showToast('Tantárgy mentve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteSubject(id) {
    if (!confirm('Biztosan törölni szeretnéd ezt a tantárgyat?')) return;
    
    try {
        await fetchAPI(`/api/subjects/${id}`, { method: 'DELETE' });
        await loadAllData();
        loadSubjectsList();
        showToast('Tantárgy törölve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Tanárok
function loadTeachersList() {
    const list = document.getElementById('teachers-list');
    list.innerHTML = teachersCache.map(t => `
        <div class="admin-item">
            <div class="item-color" style="background: ${t.color || '#3498db'}"></div>
            <div class="item-content">
                <div class="item-title">${t.name}</div>
                <div class="item-subtitle">${t.shortName || ''} - ${t.subjects || ''}</div>
            </div>
            <div class="item-actions">
                <button class="edit-btn" onclick="editTeacher('${t.id}')" title="Szerkesztés">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="delete-btn" onclick="deleteTeacher('${t.id}')" title="Törlés">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function showTeacherModal(id = null) {
    const modal = document.getElementById('teacher-modal');
    const form = document.getElementById('teacher-form');
    const title = document.getElementById('teacher-modal-title');
    
    form.reset();
    document.getElementById('teacher-id').value = id || '';
    
    if (id) {
        title.textContent = 'Tanár szerkesztése';
        const teacher = teachersCache.find(t => t.id === id);
        if (teacher) {
            document.getElementById('teacher-name').value = teacher.name;
            document.getElementById('teacher-shortname').value = teacher.shortName || '';
            document.getElementById('teacher-email').value = teacher.email || '';
            document.getElementById('teacher-subjects').value = teacher.subjects || '';
            document.getElementById('teacher-color').value = teacher.color || '#3498db';
        }
    } else {
        title.textContent = 'Új tanár';
        document.getElementById('teacher-color').value = '#3498db';
    }
    
    modal.classList.add('active');
}

function editTeacher(id) {
    showTeacherModal(id);
}

async function handleTeacherSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('teacher-id').value;
    const data = {
        name: document.getElementById('teacher-name').value,
        shortName: document.getElementById('teacher-shortname').value,
        email: document.getElementById('teacher-email').value,
        subjects: document.getElementById('teacher-subjects').value,
        color: document.getElementById('teacher-color').value
    };
    
    try {
        if (id) {
            await fetchAPI(`/api/teachers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        } else {
            await fetchAPI('/api/teachers', { method: 'POST', body: JSON.stringify(data) });
        }
        
        await loadAllData();
        loadTeachersList();
        closeModal('teacher-modal');
        showToast('Tanár mentve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteTeacher(id) {
    if (!confirm('Biztosan törölni szeretnéd ezt a tanárt?')) return;
    
    try {
        await fetchAPI(`/api/teachers/${id}`, { method: 'DELETE' });
        await loadAllData();
        loadTeachersList();
        showToast('Tanár törölve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Osztályok
function loadClassesList() {
    const list = document.getElementById('classes-list');
    list.innerHTML = classesCache.map(c => `
        <div class="admin-item">
            <div class="item-color" style="background: #667eea"></div>
            <div class="item-content">
                <div class="item-title">${c.name}</div>
                <div class="item-subtitle">${c.studentCount || 0} tanuló</div>
            </div>
            <div class="item-actions">
                <button class="edit-btn" onclick="editClass('${c.id}')" title="Szerkesztés">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="delete-btn" onclick="deleteClass('${c.id}')" title="Törlés">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function showClassModal(id = null) {
    const modal = document.getElementById('class-modal');
    const form = document.getElementById('class-form');
    const title = document.getElementById('class-modal-title');
    
    form.reset();
    document.getElementById('class-id').value = id || '';
    
    if (id) {
        title.textContent = 'Osztály szerkesztése';
        const cls = classesCache.find(c => c.id === id);
        if (cls) {
            document.getElementById('class-name').value = cls.name;
            document.getElementById('class-grade').value = cls.grade || '';
            document.getElementById('class-section').value = cls.section || '';
            document.getElementById('class-students').value = cls.studentCount || '';
        }
    } else {
        title.textContent = 'Új osztály';
    }
    
    modal.classList.add('active');
}

function editClass(id) {
    showClassModal(id);
}

async function handleClassSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('class-id').value;
    const data = {
        name: document.getElementById('class-name').value,
        grade: parseInt(document.getElementById('class-grade').value) || null,
        section: document.getElementById('class-section').value,
        studentCount: parseInt(document.getElementById('class-students').value) || 0
    };
    
    try {
        if (id) {
            await fetchAPI(`/api/classes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        } else {
            await fetchAPI('/api/classes', { method: 'POST', body: JSON.stringify(data) });
        }
        
        await loadAllData();
        loadClassesList();
        loadSelectorList();
        closeModal('class-modal');
        showToast('Osztály mentve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteClass(id) {
    if (!confirm('Biztosan törölni szeretnéd ezt az osztályt?')) return;
    
    try {
        await fetchAPI(`/api/classes/${id}`, { method: 'DELETE' });
        await loadAllData();
        loadClassesList();
        loadSelectorList();
        showToast('Osztály törölve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Termek
function loadRoomsList() {
    const list = document.getElementById('rooms-list');
    const typeLabels = {
        classroom: 'Tanterem',
        computer: 'Számítógépes',
        lab: 'Labor',
        gym: 'Tornaterem',
        library: 'Könyvtár',
        other: 'Egyéb'
    };
    
    list.innerHTML = roomsCache.map(r => `
        <div class="admin-item">
            <div class="item-color" style="background: #16a085"></div>
            <div class="item-content">
                <div class="item-title">${r.name}</div>
                <div class="item-subtitle">${r.building || '-'} épület, ${typeLabels[r.type] || r.type}, ${r.capacity || 0} fő</div>
            </div>
            <div class="item-actions">
                <button class="edit-btn" onclick="editRoom('${r.id}')" title="Szerkesztés">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="delete-btn" onclick="deleteRoom('${r.id}')" title="Törlés">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function showRoomModal(id = null) {
    const modal = document.getElementById('room-modal');
    const form = document.getElementById('room-form');
    const title = document.getElementById('room-modal-title');
    
    form.reset();
    document.getElementById('room-id').value = id || '';
    
    if (id) {
        title.textContent = 'Terem szerkesztése';
        const room = roomsCache.find(r => r.id === id);
        if (room) {
            document.getElementById('room-name').value = room.name;
            document.getElementById('room-building').value = room.building || '';
            document.getElementById('room-floor').value = room.floor || '';
            document.getElementById('room-capacity').value = room.capacity || '';
            document.getElementById('room-type').value = room.type || 'classroom';
        }
    } else {
        title.textContent = 'Új terem';
    }
    
    modal.classList.add('active');
}

function editRoom(id) {
    showRoomModal(id);
}

async function handleRoomSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('room-id').value;
    const data = {
        name: document.getElementById('room-name').value,
        building: document.getElementById('room-building').value,
        floor: parseInt(document.getElementById('room-floor').value) || 0,
        capacity: parseInt(document.getElementById('room-capacity').value) || 30,
        type: document.getElementById('room-type').value
    };
    
    try {
        if (id) {
            await fetchAPI(`/api/rooms/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        } else {
            await fetchAPI('/api/rooms', { method: 'POST', body: JSON.stringify(data) });
        }
        
        await loadAllData();
        loadRoomsList();
        loadSelectorList();
        closeModal('room-modal');
        showToast('Terem mentve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteRoom(id) {
    if (!confirm('Biztosan törölni szeretnéd ezt a termet?')) return;
    
    try {
        await fetchAPI(`/api/rooms/${id}`, { method: 'DELETE' });
        await loadAllData();
        loadRoomsList();
        loadSelectorList();
        showToast('Terem törölve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Csengetési rend
function loadPeriodsList() {
    const list = document.getElementById('periods-list');
    list.innerHTML = periodsCache.map(p => `
        <div class="admin-item">
            <div class="item-color" style="background: #f39c12"></div>
            <div class="item-content">
                <div class="item-title">${p.number}. óra</div>
                <div class="item-subtitle">${p.startTime} - ${p.endTime}</div>
            </div>
            <div class="item-actions">
                <button class="edit-btn" onclick="editPeriod('${p.id}')" title="Szerkesztés">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="delete-btn" onclick="deletePeriod('${p.id}')" title="Törlés">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function showPeriodModal(id = null) {
    const modal = document.getElementById('period-modal');
    const form = document.getElementById('period-form');
    const title = document.getElementById('period-modal-title');
    
    form.reset();
    document.getElementById('period-id').value = id || '';
    
    if (id) {
        title.textContent = 'Időpont szerkesztése';
        const period = periodsCache.find(p => p.id === id);
        if (period) {
            document.getElementById('period-number').value = period.number;
            document.getElementById('period-name').value = period.name || '';
            document.getElementById('period-start').value = period.startTime;
            document.getElementById('period-end').value = period.endTime;
        }
    } else {
        title.textContent = 'Új időpont';
    }
    
    modal.classList.add('active');
}

function editPeriod(id) {
    showPeriodModal(id);
}

async function handlePeriodSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('period-id').value;
    const data = {
        number: parseInt(document.getElementById('period-number').value),
        name: document.getElementById('period-name').value,
        startTime: document.getElementById('period-start').value,
        endTime: document.getElementById('period-end').value
    };
    
    try {
        if (id) {
            await fetchAPI(`/api/periods/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        } else {
            await fetchAPI('/api/periods', { method: 'POST', body: JSON.stringify(data) });
        }
        
        await loadAllData();
        loadPeriodsList();
        closeModal('period-modal');
        showToast('Időpont mentve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deletePeriod(id) {
    if (!confirm('Biztosan törölni szeretnéd ezt az időpontot?')) return;
    
    try {
        await fetchAPI(`/api/periods/${id}`, { method: 'DELETE' });
        await loadAllData();
        loadPeriodsList();
        showToast('Időpont törölve', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===========================
// Modal kezelés
// ===========================

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ===========================
// Toast üzenetek
// ===========================

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ===========================
// Nyomtatás és Exportálás
// ===========================

function printTimetable() {
    window.print();
}

function exportTimetable() {
    if (!currentTimetable.length) {
        showToast('Nincs mit exportálni', 'warning');
        return;
    }
    
    // CSV export
    let csv = 'Óra,Hétfő,Kedd,Szerda,Csütörtök,Péntek\n';
    
    periodsCache.forEach(period => {
        let row = [`${period.number}. (${period.startTime}-${period.endTime})`];
        
        for (let day = 1; day <= 5; day++) {
            const lesson = currentTimetable.find(l => 
                l.dayOfWeek === day && l.periodId === period.id
            );
            
            if (lesson) {
                row.push(`"${lesson.subjectName} - ${lesson.teacherName} (${lesson.roomName})"`);
            } else {
                row.push('');
            }
        }
        
        csv += row.join(',') + '\n';
    });
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `orarend_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    
    showToast('Órarend exportálva', 'success');
}

// ===========================
// Eseménykezelők
// ===========================

document.addEventListener('DOMContentLoaded', function() {
    // Session ellenőrzés
    checkSession();
    
    // Login form
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    
    // Logout
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    // Navigáció
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    
    // Admin tab váltás
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchAdminTab(btn.dataset.adminTab));
    });
    
    // Keresés
    document.getElementById('selector-search').addEventListener('input', loadSelectorList);
    
    // Szerkesztési mód
    document.getElementById('edit-mode-btn').addEventListener('click', toggleEditMode);
    
    // Nyomtatás és export
    document.getElementById('print-btn').addEventListener('click', printTimetable);
    document.getElementById('export-btn').addEventListener('click', exportTimetable);
    
    // Form submitok
    document.getElementById('lesson-form').addEventListener('submit', handleLessonSubmit);
    document.getElementById('subject-form').addEventListener('submit', handleSubjectSubmit);
    document.getElementById('teacher-form').addEventListener('submit', handleTeacherSubmit);
    document.getElementById('class-form').addEventListener('submit', handleClassSubmit);
    document.getElementById('room-form').addEventListener('submit', handleRoomSubmit);
    document.getElementById('period-form').addEventListener('submit', handlePeriodSubmit);
    
    // Modal bezárás kívül kattintásra
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
    
    // ESC billentyű
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                modal.classList.remove('active');
            });
        }
    });
    
    // Console üzenet
    console.log('%c📅 Iskolai Órarend', 'font-size: 24px; font-weight: bold; color: #667eea;');
});

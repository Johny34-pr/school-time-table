/**
 * School Timetable Server
 * Órarend kezelő szerver LDAP autentikációval
 * 
 * Port: 3001
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Database kezelő
const Database = require('./database');
const db = new Database();

// LDAP konfiguráció (school-dash projektből)
const LDAP_CONFIG = {
    server: '10.204.131.188',
    port: 636,
    useTLS: true,
    baseDN: 'dc=suli,dc=local',
    userSearchBase: 'dc=suli,dc=local',
    userSearchFilter: '(sAMAccountName={{username}})',
    groupSearchBase: 'dc=suli,dc=local',
    groupAttribute: 'memberOf'
};

// Token tárolás
const validTokens = new Map();
const TOKEN_EXPIRY = 6 * 30 * 24 * 60 * 60 * 1000; // 6 hónap

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json; charset=utf-8'
};

// LDAP kliens
let ldap;
let useLDAP = true;

try {
    ldap = require('ldapjs');
    console.log('ldapjs csomag betöltve.');
} catch (e) {
    console.log('FIGYELEM: ldapjs csomag nincs telepítve!');
    console.log('Teszt módban fut a szerver.\n');
    useLDAP = false;
}

/**
 * Token generálása
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Token mentése
 */
function saveToken(token, username, user, groups) {
    validTokens.set(token, {
        username: username,
        user: user,
        groups: groups,
        createdAt: Date.now(),
        expiresAt: Date.now() + TOKEN_EXPIRY
    });
    cleanupExpiredTokens();
}

/**
 * Lejárt tokenek törlése
 */
function cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, data] of validTokens.entries()) {
        if (data.expiresAt < now) {
            validTokens.delete(token);
        }
    }
}

/**
 * Token validálása
 */
function validateToken(token, username) {
    const tokenData = validTokens.get(token);
    if (!tokenData) return { valid: false };
    if (tokenData.expiresAt < Date.now()) {
        validTokens.delete(token);
        return { valid: false };
    }
    if (tokenData.username !== username) return { valid: false };
    return { valid: true, user: tokenData.user, groups: tokenData.groups };
}

/**
 * Token adatok lekérése
 */
function getTokenData(token) {
    const tokenData = validTokens.get(token);
    if (!tokenData) return null;
    if (tokenData.expiresAt < Date.now()) {
        validTokens.delete(token);
        return null;
    }
    return tokenData;
}

/**
 * Jogosultság ellenőrzése
 */
function hasPermission(groups, allowedRoles) {
    return groups.some(g => allowedRoles.includes(g.toLowerCase()));
}

/**
 * wbinfo-val csoport lekérés
 */
function getUserInfoFromWbinfo(username) {
    return new Promise((resolve) => {
        exec(`wbinfo --user-groups ${username}`, (error, stdout, stderr) => {
            if (error) {
                resolve(null);
                return;
            }
            const groupIds = stdout.trim().split('\n').filter(id => id);
            if (groupIds.length === 0) {
                resolve({ groups: [] });
                return;
            }
            const groupPromises = groupIds.map(gid => {
                return new Promise((resolveGroup) => {
                    exec(`wbinfo --gid-info ${gid}`, (err, out) => {
                        if (err || !out) {
                            resolveGroup(null);
                            return;
                        }
                        const parts = out.trim().split(':');
                        if (parts.length > 0) {
                            resolveGroup(parts[0].toLowerCase());
                        } else {
                            resolveGroup(null);
                        }
                    });
                });
            });
            Promise.all(groupPromises).then(groupNames => {
                resolve({ groups: groupNames.filter(g => g !== null) });
            });
        });
    });
}

/**
 * LDAP autentikáció
 */
async function authenticateLDAP(username, password) {
    return new Promise(async (resolve) => {
        if (!useLDAP) {
            resolve(testAuthentication(username, password));
            return;
        }

        const userDN = `${username}@suli.local`;
        const clientOptions = {
            url: `ldaps://${LDAP_CONFIG.server}:${LDAP_CONFIG.port}`,
            tlsOptions: { rejectUnauthorized: false },
            connectTimeout: 10000,
            timeout: 10000
        };

        console.log(`[LDAP] Kapcsolódás: ${clientOptions.url}`);
        console.log(`[LDAP] Felhasználó: ${userDN}`);

        const client = ldap.createClient(clientOptions);

        client.on('error', (err) => {
            console.log(`[LDAP] Kapcsolati hiba: ${err.message}`);
            resolve({ success: false, error: 'LDAP szerver nem elérhető' });
        });

        client.on('connectError', (err) => {
            console.log(`[LDAP] Kapcsolódási hiba: ${err.message}`);
            resolve({ success: false, error: 'Nem sikerült csatlakozni az LDAP szerverhez' });
        });

        client.bind(userDN, password, async (err) => {
            if (err) {
                console.log(`[LDAP] Bind hiba: ${err.message}`);
                client.unbind();
                resolve({ success: false, error: 'Hibás felhasználónév vagy jelszó' });
                return;
            }

            console.log(`[LDAP] Sikeres bind: ${username}`);

            const searchOptions = {
                filter: `(sAMAccountName=${username})`,
                scope: 'sub',
                attributes: ['displayName', 'mail', 'memberOf', 'sAMAccountName']
            };

            client.search(LDAP_CONFIG.userSearchBase, searchOptions, async (searchErr, searchRes) => {
                if (searchErr) {
                    console.log(`[LDAP] Keresési hiba: ${searchErr.message}`);
                    const wbinfoResult = await getUserInfoFromWbinfo(username);
                    client.unbind();
                    resolve({
                        success: true,
                        user: { username: username, displayName: username },
                        groups: wbinfoResult ? wbinfoResult.groups : []
                    });
                    return;
                }

                let user = null;
                let groups = [];

                searchRes.on('searchEntry', (entry) => {
                    const attrs = {};
                    entry.attributes.forEach(attr => {
                        if (attr.values && attr.values.length === 1) {
                            attrs[attr.type] = attr.values[0];
                        } else if (attr.values) {
                            attrs[attr.type] = attr.values;
                        }
                    });

                    user = {
                        username: attrs.sAMAccountName || username,
                        displayName: attrs.displayName || username,
                        email: attrs.mail || ''
                    };

                    if (attrs.memberOf) {
                        const memberOf = Array.isArray(attrs.memberOf) ? attrs.memberOf : [attrs.memberOf];
                        groups = memberOf.map(dn => {
                            const match = dn.match(/^CN=([^,]+)/i);
                            return match ? match[1].toLowerCase() : null;
                        }).filter(g => g !== null);
                    }
                });

                searchRes.on('error', async (err) => {
                    const wbinfoResult = await getUserInfoFromWbinfo(username);
                    client.unbind();
                    resolve({
                        success: true,
                        user: user || { username: username, displayName: username },
                        groups: wbinfoResult ? wbinfoResult.groups : []
                    });
                });

                searchRes.on('end', async () => {
                    client.unbind();
                    if (!user) user = { username: username, displayName: username };
                    if (groups.length === 0) {
                        const wbinfoResult = await getUserInfoFromWbinfo(username);
                        if (wbinfoResult && wbinfoResult.groups) groups = wbinfoResult.groups;
                    }
                    resolve({ success: true, user: user, groups: groups });
                });
            });
        });
    });
}

/**
 * Teszt autentikáció
 */
function testAuthentication(username, password) {
    const testUsers = {
        'admin': { password: 'admin', groups: ['rendszergaza'], displayName: 'Rendszergazda' },
        'igazgato': { password: 'igazgato', groups: ['vezetoseg'], displayName: 'Igazgató' },
        'tanar': { password: 'tanar', groups: ['tanarok'], displayName: 'Teszt Tanár' },
        'irodista': { password: 'irodista', groups: ['irodistak'], displayName: 'Teszt Irodista' },
        'diak': { password: 'diak', groups: ['tanulo'], displayName: 'Teszt Diák' }
    };

    if (testUsers[username] && testUsers[username].password === password) {
        return {
            success: true,
            user: { username: username, displayName: testUsers[username].displayName },
            groups: testUsers[username].groups
        };
    }
    return { success: false, error: 'Hibás felhasználónév vagy jelszó' };
}

/**
 * Request body olvasása
 */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

/**
 * Statikus fájlok kiszolgálása
 */
function serveStaticFile(filePath, res) {
    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
            return;
        }
        res.writeHead(200, { 'Content-Type': contentTypes[extname] || 'application/octet-stream' });
        res.end(content);
    });
}

/**
 * API útvonalak kezelése
 */
async function handleAPI(req, res, pathname) {
    const method = req.method;

    // Auth API-k
    if (pathname === '/api/ldap/auth' && method === 'POST') {
        const { username, password } = await readBody(req);
        if (!username || !password) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: 'Felhasználónév és jelszó megadása kötelező' }));
            return;
        }
        const result = await authenticateLDAP(username, password);
        if (result.success) {
            const token = generateToken();
            saveToken(token, username, result.user, result.groups);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, user: result.user, groups: result.groups, token: token }));
        } else {
            res.writeHead(401, corsHeaders);
            res.end(JSON.stringify({ error: result.error }));
        }
        return;
    }

    if (pathname === '/api/auth/validate' && method === 'POST') {
        const { token, username } = await readBody(req);
        if (!token || !username) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ valid: false, error: 'Token és username megadása kötelező' }));
            return;
        }
        const result = validateToken(token, username);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(result));
        return;
    }

    // Authorization header ellenőrzése
    const authHeader = req.headers.authorization;
    let tokenData = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        tokenData = getTokenData(token);
    }

    // Publikus API-k (órarend megtekintése)
    if (pathname === '/api/classes' && method === 'GET') {
        const classes = db.getClasses();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(classes));
        return;
    }

    if (pathname === '/api/teachers' && method === 'GET') {
        const teachers = db.getTeachers();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(teachers));
        return;
    }

    if (pathname === '/api/rooms' && method === 'GET') {
        const rooms = db.getRooms();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(rooms));
        return;
    }

    if (pathname === '/api/subjects' && method === 'GET') {
        const subjects = db.getSubjects();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(subjects));
        return;
    }

    if (pathname === '/api/periods' && method === 'GET') {
        const periods = db.getPeriods();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(periods));
        return;
    }

    if (pathname.startsWith('/api/timetable/class/') && method === 'GET') {
        const classId = pathname.split('/').pop();
        const timetable = db.getTimetableByClass(classId);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(timetable));
        return;
    }

    if (pathname.startsWith('/api/timetable/teacher/') && method === 'GET') {
        const teacherId = pathname.split('/').pop();
        const timetable = db.getTimetableByTeacher(teacherId);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(timetable));
        return;
    }

    if (pathname.startsWith('/api/timetable/room/') && method === 'GET') {
        const roomId = pathname.split('/').pop();
        const timetable = db.getTimetableByRoom(roomId);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(timetable));
        return;
    }

    // Helyettesítések - publikus lekérdezés
    if (pathname === '/api/substitutions' && method === 'GET') {
        const query = url.parse(req.url, true).query;
        const substitutions = db.getSubstitutions(query.date, query.startDate, query.endDate);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(substitutions));
        return;
    }

    if (pathname.startsWith('/api/substitutions/class/') && method === 'GET') {
        const parts = pathname.split('/');
        const classId = parts[parts.length - 2];
        const date = parts[parts.length - 1];
        const substitutions = db.getSubstitutionsByClass(classId, date);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(substitutions));
        return;
    }

    if (pathname.startsWith('/api/substitutions/teacher/') && method === 'GET') {
        const teacherId = pathname.split('/').pop();
        const query = url.parse(req.url, true).query;
        const substitutions = db.getSubstitutionsByTeacher(teacherId, query.startDate, query.endDate);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(substitutions));
        return;
    }

    // Védett API-k (szerkesztés) - jogosultság szükséges
    const editRoles = ['vezetoseg', 'rendszergaza', 'tanarok', 'irodistak'];

    if (!tokenData) {
        res.writeHead(401, corsHeaders);
        res.end(JSON.stringify({ error: 'Bejelentkezés szükséges' }));
        return;
    }

    const canEdit = hasPermission(tokenData.groups, editRoles);

    // Helyettesítés létrehozása
    if (pathname === '/api/substitutions' && method === 'POST') {
        if (!canEdit) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod helyettesítés létrehozásához' }));
            return;
        }
        const data = await readBody(req);
        data.created_by = tokenData.username;
        try {
            const id = db.addSubstitution(data);
            res.writeHead(201, corsHeaders);
            res.end(JSON.stringify({ success: true, id: id }));
        } catch (e) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (pathname.startsWith('/api/substitutions/') && method === 'PUT') {
        if (!canEdit) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod helyettesítés módosításához' }));
            return;
        }
        const id = pathname.split('/').pop();
        const data = await readBody(req);
        try {
            db.updateSubstitution(id, data);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (pathname.startsWith('/api/substitutions/') && method === 'DELETE') {
        if (!canEdit) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod helyettesítés törléséhez' }));
            return;
        }
        const id = pathname.split('/').pop();
        try {
            db.deleteSubstitution(id);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // Órarend szerkesztése
    if (pathname === '/api/timetable' && method === 'POST') {
        if (!canEdit) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod az órarend szerkesztéséhez' }));
            return;
        }
        const data = await readBody(req);
        try {
            const id = db.addTimetableEntry(data);
            res.writeHead(201, corsHeaders);
            res.end(JSON.stringify({ success: true, id: id }));
        } catch (e) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (pathname.startsWith('/api/timetable/') && method === 'PUT') {
        if (!canEdit) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod az órarend szerkesztéséhez' }));
            return;
        }
        const id = pathname.split('/').pop();
        const data = await readBody(req);
        try {
            db.updateTimetableEntry(id, data);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    if (pathname.startsWith('/api/timetable/') && method === 'DELETE') {
        if (!canEdit) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod az órarend szerkesztéséhez' }));
            return;
        }
        const id = pathname.split('/').pop();
        try {
            db.deleteTimetableEntry(id);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // Admin API-k (csak vezetőség és rendszergazda)
    const adminRoles = ['vezetoseg', 'rendszergaza'];
    const isAdmin = hasPermission(tokenData.groups, adminRoles);

    // Osztályok kezelése
    if (pathname === '/api/classes' && method === 'POST') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const data = await readBody(req);
        const id = db.addClass(data);
        res.writeHead(201, corsHeaders);
        res.end(JSON.stringify({ success: true, id: id }));
        return;
    }

    if (pathname.startsWith('/api/classes/') && method === 'PUT') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        const data = await readBody(req);
        db.updateClass(id, data);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (pathname.startsWith('/api/classes/') && method === 'DELETE') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        db.deleteClass(id);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Tanárok kezelése
    if (pathname === '/api/teachers' && method === 'POST') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const data = await readBody(req);
        const id = db.addTeacher(data);
        res.writeHead(201, corsHeaders);
        res.end(JSON.stringify({ success: true, id: id }));
        return;
    }

    if (pathname.startsWith('/api/teachers/') && method === 'PUT') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        const data = await readBody(req);
        db.updateTeacher(id, data);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (pathname.startsWith('/api/teachers/') && method === 'DELETE') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        db.deleteTeacher(id);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Termek kezelése
    if (pathname === '/api/rooms' && method === 'POST') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const data = await readBody(req);
        const id = db.addRoom(data);
        res.writeHead(201, corsHeaders);
        res.end(JSON.stringify({ success: true, id: id }));
        return;
    }

    if (pathname.startsWith('/api/rooms/') && method === 'PUT') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        const data = await readBody(req);
        db.updateRoom(id, data);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (pathname.startsWith('/api/rooms/') && method === 'DELETE') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        db.deleteRoom(id);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Tantárgyak kezelése
    if (pathname === '/api/subjects' && method === 'POST') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const data = await readBody(req);
        const id = db.addSubject(data);
        res.writeHead(201, corsHeaders);
        res.end(JSON.stringify({ success: true, id: id }));
        return;
    }

    if (pathname.startsWith('/api/subjects/') && method === 'PUT') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        const data = await readBody(req);
        db.updateSubject(id, data);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (pathname.startsWith('/api/subjects/') && method === 'DELETE') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        db.deleteSubject(id);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Csengetési rend kezelése
    if (pathname === '/api/periods' && method === 'POST') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const data = await readBody(req);
        const id = db.addPeriod(data);
        res.writeHead(201, corsHeaders);
        res.end(JSON.stringify({ success: true, id: id }));
        return;
    }

    if (pathname.startsWith('/api/periods/') && method === 'PUT') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        const data = await readBody(req);
        db.updatePeriod(id, data);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (pathname.startsWith('/api/periods/') && method === 'DELETE') {
        if (!isAdmin) {
            res.writeHead(403, corsHeaders);
            res.end(JSON.stringify({ error: 'Nincs jogosultságod' }));
            return;
        }
        const id = pathname.split('/').pop();
        db.deletePeriod(id);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // 404 - Ismeretlen API végpont
    res.writeHead(404, corsHeaders);
    res.end(JSON.stringify({ error: 'Nem található' }));
}

/**
 * HTTP szerver
 */
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    // API végpontok
    if (pathname.startsWith('/api/')) {
        try {
            await handleAPI(req, res, pathname);
        } catch (e) {
            console.error('[API] Hiba:', e);
            res.writeHead(500, corsHeaders);
            res.end(JSON.stringify({ error: 'Szerver hiba' }));
        }
        return;
    }

    // Statikus fájlok
    let filePath = path.join(__dirname, '..', pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(path.join(__dirname, '..'))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    serveStaticFile(filePath, res);
});

const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║       Iskolai Órarend - Auth Server              ║
╠══════════════════════════════════════════════════╣
║  Szerver fut: http://localhost:${PORT}              ║
║  LDAP Szerver: ${LDAP_CONFIG.server}                ║
║  Token lejárat: 6 hónap                          ║
╠══════════════════════════════════════════════════╣
║  Teszt felhasználók:                             ║
║    admin/admin       - Rendszergazda             ║
║    igazgato/igazgato - Vezetőség                 ║
║    tanar/tanar       - Tanár                     ║
║    irodista/irodista - Irodista                  ║
║    diak/diak         - Tanuló                    ║
╠══════════════════════════════════════════════════╣
║  Jogosultságok:                                  ║
║    Vezetőség/Admin: Teljes hozzáférés            ║
║    Tanár/Irodista: Órarend szerkesztés           ║
║    Diák: Csak megtekintés                        ║
╚══════════════════════════════════════════════════╝
    `);
});

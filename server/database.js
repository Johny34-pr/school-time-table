/**
 * Database kezelő modul
 * SQLite adatbázis az órarendekhez
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');

let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    console.log('FIGYELEM: better-sqlite3 nincs telepítve, memória adatbázis használata');
    Database = null;
}

class TimetableDatabase {
    constructor() {
        if (Database) {
            // Adatbázis a /data mappába kerül, hogy a Docker volume megőrizze
            const dataDir = path.join(__dirname, 'data');
            if (!require('fs').existsSync(dataDir)) {
                require('fs').mkdirSync(dataDir, { recursive: true });
            }
            const dbPath = path.join(dataDir, 'timetable.db');
            this.db = new Database(dbPath);
            this.db.pragma('journal_mode = WAL');
        } else {
            // In-memory fallback
            this.inMemory = true;
            this.data = {
                classes: [],
                teachers: [],
                rooms: [],
                subjects: [],
                periods: [],
                timetable: []
            };
        }
        this.initTables();
        this.migrateDatabase();
        this.seedData();
    }

    initTables() {
        if (this.inMemory) return;

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS classes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                grade INTEGER,
                section TEXT,
                headTeacher TEXT,
                studentCount INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS teachers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                shortName TEXT,
                email TEXT,
                subjects TEXT,
                color TEXT DEFAULT '#3498db',
                ldapUsername TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                building TEXT,
                floor INTEGER,
                capacity INTEGER DEFAULT 30,
                type TEXT DEFAULT 'classroom',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS subjects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                shortName TEXT,
                color TEXT DEFAULT '#2ecc71',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS periods (
                id TEXT PRIMARY KEY,
                number INTEGER NOT NULL,
                startTime TEXT NOT NULL,
                endTime TEXT NOT NULL,
                isBreak INTEGER DEFAULT 0,
                name TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS timetable (
                id TEXT PRIMARY KEY,
                dayOfWeek INTEGER NOT NULL,
                periodId TEXT NOT NULL,
                classId TEXT NOT NULL,
                subjectId TEXT NOT NULL,
                teacherId TEXT NOT NULL,
                roomId TEXT NOT NULL,
                note TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (periodId) REFERENCES periods(id),
                FOREIGN KEY (classId) REFERENCES classes(id),
                FOREIGN KEY (subjectId) REFERENCES subjects(id),
                FOREIGN KEY (teacherId) REFERENCES teachers(id),
                FOREIGN KEY (roomId) REFERENCES rooms(id)
            );

            CREATE INDEX IF NOT EXISTS idx_timetable_class ON timetable(classId);
            CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable(teacherId);
            CREATE INDEX IF NOT EXISTS idx_timetable_room ON timetable(roomId);
            CREATE INDEX IF NOT EXISTS idx_timetable_day ON timetable(dayOfWeek);

            CREATE TABLE IF NOT EXISTS substitutions (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                periodId TEXT NOT NULL,
                classId TEXT NOT NULL,
                originalTeacherId TEXT,
                substituteTeacherId TEXT NOT NULL,
                subjectId TEXT,
                roomId TEXT,
                reason TEXT,
                note TEXT,
                cancelled INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT,
                FOREIGN KEY (periodId) REFERENCES periods(id),
                FOREIGN KEY (classId) REFERENCES classes(id),
                FOREIGN KEY (originalTeacherId) REFERENCES teachers(id),
                FOREIGN KEY (substituteTeacherId) REFERENCES teachers(id),
                FOREIGN KEY (subjectId) REFERENCES subjects(id),
                FOREIGN KEY (roomId) REFERENCES rooms(id)
            );

            CREATE INDEX IF NOT EXISTS idx_substitutions_date ON substitutions(date);
            CREATE INDEX IF NOT EXISTS idx_substitutions_class ON substitutions(classId);
            CREATE INDEX IF NOT EXISTS idx_substitutions_teacher ON substitutions(substituteTeacherId);
        `);
    }

    migrateDatabase() {
        if (this.inMemory) return;

        // Ellenőrizzük, hogy létezik-e az ldapUsername oszlop
        try {
            const tableInfo = this.db.prepare("PRAGMA table_info(teachers)").all();
            const hasLdapUsername = tableInfo.some(col => col.name === 'ldapUsername');
            
            if (!hasLdapUsername) {
                console.log('[DB] Migráció: ldapUsername oszlop hozzáadása a teachers táblához...');
                this.db.exec('ALTER TABLE teachers ADD COLUMN ldapUsername TEXT');
                console.log('[DB] Migráció sikeres!');
            }
            
            // Ellenőrizzük, hogy létezik-e a classes oszlop
            const hasClasses = tableInfo.some(col => col.name === 'classes');
            if (!hasClasses) {
                console.log('[DB] Migráció: classes oszlop hozzáadása a teachers táblához...');
                this.db.exec('ALTER TABLE teachers ADD COLUMN classes TEXT');
                console.log('[DB] Migráció sikeres!');
            }
        } catch (e) {
            console.log('[DB] Migráció hiba:', e.message);
        }
    }

    seedData() {
        // Ellenőrizzük, hogy van-e már adat
        let hasData = false;
        if (this.inMemory) {
            hasData = this.data.periods.length > 0;
        } else {
            const count = this.db.prepare('SELECT COUNT(*) as count FROM periods').get();
            hasData = count.count > 0;
        }

        if (hasData) return;

        console.log('[DB] Alapadatok betöltése...');

        // Csengetési rend
        const periods = [
            { number: 1, startTime: '07:15', endTime: '08:00', name: '1. óra' },
            { number: 2, startTime: '08:10', endTime: '08:55', name: '2. óra' },
            { number: 3, startTime: '09:05', endTime: '09:50', name: '3. óra' },
            { number: 4, startTime: '10:00', endTime: '10:45', name: '4. óra' },
            { number: 5, startTime: '10:55', endTime: '11:40', name: '5. óra' },
            { number: 6, startTime: '11:50', endTime: '12:35', name: '6. óra' },
            { number: 7, startTime: '12:45', endTime: '13:30', name: '7. óra' },
            { number: 8, startTime: '13:40', endTime: '14:25', name: '8. óra' }
        ];

        periods.forEach(p => this.addPeriod(p));

        // Tantárgyak
        const subjects = [
            { name: 'Magyar nyelv és irodalom', shortName: 'Magyar', color: '#e74c3c' },
            { name: 'Matematika', shortName: 'Matek', color: '#3498db' },
            { name: 'Történelem', shortName: 'Töri', color: '#9b59b6' },
            { name: 'Angol nyelv', shortName: 'Angol', color: '#1abc9c' },
            { name: 'Német nyelv', shortName: 'Német', color: '#f39c12' },
            { name: 'Fizika', shortName: 'Fizika', color: '#2ecc71' },
            { name: 'Kémia', shortName: 'Kémia', color: '#e67e22' },
            { name: 'Biológia', shortName: 'Bio', color: '#27ae60' },
            { name: 'Földrajz', shortName: 'Földrajz', color: '#16a085' },
            { name: 'Informatika', shortName: 'Info', color: '#8e44ad' },
            { name: 'Testnevelés', shortName: 'Tesi', color: '#c0392b' },
            { name: 'Ének-zene', shortName: 'Ének', color: '#d35400' },
            { name: 'Rajz és vizuális kultúra', shortName: 'Rajz', color: '#f1c40f' },
            { name: 'Osztályfőnöki', shortName: 'Ofő', color: '#34495e' }
        ];

        subjects.forEach(s => this.addSubject(s));

        // Osztályok
        const classes = [
            { name: '9.A', grade: 9, section: 'A', studentCount: 28 },
            { name: '9.B', grade: 9, section: 'B', studentCount: 30 },
            { name: '9.C', grade: 9, section: 'C', studentCount: 27 },
            { name: '10.A', grade: 10, section: 'A', studentCount: 29 },
            { name: '10.B', grade: 10, section: 'B', studentCount: 31 },
            { name: '10.C', grade: 10, section: 'C', studentCount: 26 },
            { name: '11.A', grade: 11, section: 'A', studentCount: 25 },
            { name: '11.B', grade: 11, section: 'B', studentCount: 28 },
            { name: '12.A', grade: 12, section: 'A', studentCount: 24 },
            { name: '12.B', grade: 12, section: 'B', studentCount: 26 }
        ];

        classes.forEach(c => this.addClass(c));

        // Termek
        const rooms = [
            { name: '101', building: 'A', floor: 1, capacity: 30, type: 'classroom' },
            { name: '102', building: 'A', floor: 1, capacity: 30, type: 'classroom' },
            { name: '103', building: 'A', floor: 1, capacity: 30, type: 'classroom' },
            { name: '201', building: 'A', floor: 2, capacity: 30, type: 'classroom' },
            { name: '202', building: 'A', floor: 2, capacity: 30, type: 'classroom' },
            { name: '203', building: 'A', floor: 2, capacity: 30, type: 'classroom' },
            { name: 'Informatika 1', building: 'B', floor: 1, capacity: 20, type: 'computer' },
            { name: 'Informatika 2', building: 'B', floor: 1, capacity: 20, type: 'computer' },
            { name: 'Fizika labor', building: 'B', floor: 2, capacity: 25, type: 'lab' },
            { name: 'Kémia labor', building: 'B', floor: 2, capacity: 25, type: 'lab' },
            { name: 'Tornaterem', building: 'C', floor: 0, capacity: 60, type: 'gym' },
            { name: 'Könyvtár', building: 'A', floor: 0, capacity: 40, type: 'library' }
        ];

        rooms.forEach(r => this.addRoom(r));

        // Tanárok
        const teachers = [
            { name: 'Kovács Mária', shortName: 'KM', email: 'kovacs.maria@iskola.hu', subjects: 'Magyar nyelv és irodalom', color: '#e74c3c' },
            { name: 'Nagy István', shortName: 'NI', email: 'nagy.istvan@iskola.hu', subjects: 'Matematika', color: '#3498db' },
            { name: 'Szabó Anna', shortName: 'SZA', email: 'szabo.anna@iskola.hu', subjects: 'Történelem', color: '#9b59b6' },
            { name: 'Tóth Péter', shortName: 'TP', email: 'toth.peter@iskola.hu', subjects: 'Angol nyelv', color: '#1abc9c' },
            { name: 'Kiss Katalin', shortName: 'KK', email: 'kiss.katalin@iskola.hu', subjects: 'Német nyelv', color: '#f39c12' },
            { name: 'Horváth János', shortName: 'HJ', email: 'horvath.janos@iskola.hu', subjects: 'Fizika', color: '#2ecc71' },
            { name: 'Molnár Éva', shortName: 'ME', email: 'molnar.eva@iskola.hu', subjects: 'Kémia', color: '#e67e22' },
            { name: 'Varga Gábor', shortName: 'VG', email: 'varga.gabor@iskola.hu', subjects: 'Biológia', color: '#27ae60' },
            { name: 'Farkas Zoltán', shortName: 'FZ', email: 'farkas.zoltan@iskola.hu', subjects: 'Földrajz', color: '#16a085' },
            { name: 'Balogh Tamás', shortName: 'BT', email: 'balogh.tamas@iskola.hu', subjects: 'Informatika', color: '#8e44ad' },
            { name: 'Németh László', shortName: 'NL', email: 'nemeth.laszlo@iskola.hu', subjects: 'Testnevelés', color: '#c0392b' },
            { name: 'Papp Judit', shortName: 'PJ', email: 'papp.judit@iskola.hu', subjects: 'Ének-zene', color: '#d35400' }
        ];

        teachers.forEach(t => this.addTeacher(t));

        console.log('[DB] Alapadatok betöltve.');
    }

    // CRUD műveletek - Classes
    getClasses() {
        if (this.inMemory) return this.data.classes;
        return this.db.prepare('SELECT * FROM classes ORDER BY grade, section').all();
    }

    addClass(data) {
        const id = uuidv4();
        if (this.inMemory) {
            this.data.classes.push({ id, ...data });
        } else {
            this.db.prepare(`
                INSERT INTO classes (id, name, grade, section, headTeacher, studentCount)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id, data.name, data.grade, data.section, data.headTeacher, data.studentCount);
        }
        return id;
    }

    updateClass(id, data) {
        if (this.inMemory) {
            const idx = this.data.classes.findIndex(c => c.id === id);
            if (idx >= 0) this.data.classes[idx] = { ...this.data.classes[idx], ...data };
        } else {
            this.db.prepare(`
                UPDATE classes SET name = ?, grade = ?, section = ?, headTeacher = ?, studentCount = ?
                WHERE id = ?
            `).run(data.name, data.grade, data.section, data.headTeacher, data.studentCount, id);
        }
    }

    deleteClass(id) {
        if (this.inMemory) {
            this.data.classes = this.data.classes.filter(c => c.id !== id);
        } else {
            this.db.prepare('DELETE FROM classes WHERE id = ?').run(id);
        }
    }

    // CRUD műveletek - Teachers
    getTeachers() {
        if (this.inMemory) return this.data.teachers;
        return this.db.prepare('SELECT * FROM teachers ORDER BY name').all();
    }

    addTeacher(data) {
        const id = uuidv4();
        if (this.inMemory) {
            this.data.teachers.push({ id, ...data });
        } else {
            this.db.prepare(`
                INSERT INTO teachers (id, name, shortName, email, subjects, classes, color, ldapUsername)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, data.name, data.shortName, data.email, data.subjects, data.classes || null, data.color, data.ldapUsername || null);
        }
        return id;
    }

    updateTeacher(id, data) {
        if (this.inMemory) {
            const idx = this.data.teachers.findIndex(t => t.id === id);
            if (idx >= 0) this.data.teachers[idx] = { ...this.data.teachers[idx], ...data };
        } else {
            this.db.prepare(`
                UPDATE teachers SET name = ?, shortName = ?, email = ?, subjects = ?, classes = ?, color = ?, ldapUsername = ?
                WHERE id = ?
            `).run(data.name, data.shortName, data.email, data.subjects, data.classes || null, data.color, data.ldapUsername || null, id);
        }
    }

    deleteTeacher(id) {
        if (this.inMemory) {
            this.data.teachers = this.data.teachers.filter(t => t.id !== id);
        } else {
            this.db.prepare('DELETE FROM teachers WHERE id = ?').run(id);
        }
    }

    // CRUD műveletek - Rooms
    getRooms() {
        if (this.inMemory) return this.data.rooms;
        return this.db.prepare('SELECT * FROM rooms ORDER BY building, name').all();
    }

    addRoom(data) {
        const id = uuidv4();
        if (this.inMemory) {
            this.data.rooms.push({ id, ...data });
        } else {
            this.db.prepare(`
                INSERT INTO rooms (id, name, building, floor, capacity, type)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id, data.name, data.building, data.floor, data.capacity, data.type);
        }
        return id;
    }

    updateRoom(id, data) {
        if (this.inMemory) {
            const idx = this.data.rooms.findIndex(r => r.id === id);
            if (idx >= 0) this.data.rooms[idx] = { ...this.data.rooms[idx], ...data };
        } else {
            this.db.prepare(`
                UPDATE rooms SET name = ?, building = ?, floor = ?, capacity = ?, type = ?
                WHERE id = ?
            `).run(data.name, data.building, data.floor, data.capacity, data.type, id);
        }
    }

    deleteRoom(id) {
        if (this.inMemory) {
            this.data.rooms = this.data.rooms.filter(r => r.id !== id);
        } else {
            this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
        }
    }

    // CRUD műveletek - Subjects
    getSubjects() {
        if (this.inMemory) return this.data.subjects;
        return this.db.prepare('SELECT * FROM subjects ORDER BY name').all();
    }

    addSubject(data) {
        const id = uuidv4();
        if (this.inMemory) {
            this.data.subjects.push({ id, ...data });
        } else {
            this.db.prepare(`
                INSERT INTO subjects (id, name, shortName, color)
                VALUES (?, ?, ?, ?)
            `).run(id, data.name, data.shortName, data.color);
        }
        return id;
    }

    updateSubject(id, data) {
        if (this.inMemory) {
            const idx = this.data.subjects.findIndex(s => s.id === id);
            if (idx >= 0) this.data.subjects[idx] = { ...this.data.subjects[idx], ...data };
        } else {
            this.db.prepare(`
                UPDATE subjects SET name = ?, shortName = ?, color = ?
                WHERE id = ?
            `).run(data.name, data.shortName, data.color, id);
        }
    }

    deleteSubject(id) {
        if (this.inMemory) {
            this.data.subjects = this.data.subjects.filter(s => s.id !== id);
        } else {
            this.db.prepare('DELETE FROM subjects WHERE id = ?').run(id);
        }
    }

    // CRUD műveletek - Periods
    getPeriods() {
        if (this.inMemory) return this.data.periods.sort((a, b) => a.number - b.number);
        return this.db.prepare('SELECT * FROM periods ORDER BY number').all();
    }

    addPeriod(data) {
        const id = uuidv4();
        if (this.inMemory) {
            this.data.periods.push({ id, ...data });
        } else {
            this.db.prepare(`
                INSERT INTO periods (id, number, startTime, endTime, isBreak, name)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id, data.number, data.startTime, data.endTime, data.isBreak ? 1 : 0, data.name);
        }
        return id;
    }

    updatePeriod(id, data) {
        if (this.inMemory) {
            const idx = this.data.periods.findIndex(p => p.id === id);
            if (idx >= 0) this.data.periods[idx] = { ...this.data.periods[idx], ...data };
        } else {
            this.db.prepare(`
                UPDATE periods SET number = ?, startTime = ?, endTime = ?, isBreak = ?, name = ?
                WHERE id = ?
            `).run(data.number, data.startTime, data.endTime, data.isBreak ? 1 : 0, data.name, id);
        }
    }

    deletePeriod(id) {
        if (this.inMemory) {
            this.data.periods = this.data.periods.filter(p => p.id !== id);
        } else {
            this.db.prepare('DELETE FROM periods WHERE id = ?').run(id);
        }
    }

    // CRUD műveletek - Timetable
    getTimetableByClass(classId) {
        if (this.inMemory) {
            return this.data.timetable
                .filter(t => t.classId === classId)
                .map(t => this.enrichTimetableEntry(t));
        }
        return this.db.prepare(`
            SELECT t.*, 
                   c.name as className, c.grade, c.section,
                   s.name as subjectName, s.shortName as subjectShortName, s.color as subjectColor,
                   te.name as teacherName, te.shortName as teacherShortName,
                   r.name as roomName, r.building,
                   p.number as periodNumber, p.startTime, p.endTime
            FROM timetable t
            JOIN classes c ON t.classId = c.id
            JOIN subjects s ON t.subjectId = s.id
            JOIN teachers te ON t.teacherId = te.id
            JOIN rooms r ON t.roomId = r.id
            JOIN periods p ON t.periodId = p.id
            WHERE t.classId = ?
            ORDER BY t.dayOfWeek, p.number
        `).all(classId);
    }

    getTimetableByTeacher(teacherId) {
        if (this.inMemory) {
            return this.data.timetable
                .filter(t => t.teacherId === teacherId)
                .map(t => this.enrichTimetableEntry(t));
        }
        return this.db.prepare(`
            SELECT t.*, 
                   c.name as className, c.grade, c.section,
                   s.name as subjectName, s.shortName as subjectShortName, s.color as subjectColor,
                   te.name as teacherName, te.shortName as teacherShortName,
                   r.name as roomName, r.building,
                   p.number as periodNumber, p.startTime, p.endTime
            FROM timetable t
            JOIN classes c ON t.classId = c.id
            JOIN subjects s ON t.subjectId = s.id
            JOIN teachers te ON t.teacherId = te.id
            JOIN rooms r ON t.roomId = r.id
            JOIN periods p ON t.periodId = p.id
            WHERE t.teacherId = ?
            ORDER BY t.dayOfWeek, p.number
        `).all(teacherId);
    }

    getTimetableByRoom(roomId) {
        if (this.inMemory) {
            return this.data.timetable
                .filter(t => t.roomId === roomId)
                .map(t => this.enrichTimetableEntry(t));
        }
        return this.db.prepare(`
            SELECT t.*, 
                   c.name as className, c.grade, c.section,
                   s.name as subjectName, s.shortName as subjectShortName, s.color as subjectColor,
                   te.name as teacherName, te.shortName as teacherShortName,
                   r.name as roomName, r.building,
                   p.number as periodNumber, p.startTime, p.endTime
            FROM timetable t
            JOIN classes c ON t.classId = c.id
            JOIN subjects s ON t.subjectId = s.id
            JOIN teachers te ON t.teacherId = te.id
            JOIN rooms r ON t.roomId = r.id
            JOIN periods p ON t.periodId = p.id
            WHERE t.roomId = ?
            ORDER BY t.dayOfWeek, p.number
        `).all(roomId);
    }

    enrichTimetableEntry(entry) {
        const cls = this.data.classes.find(c => c.id === entry.classId);
        const subject = this.data.subjects.find(s => s.id === entry.subjectId);
        const teacher = this.data.teachers.find(t => t.id === entry.teacherId);
        const room = this.data.rooms.find(r => r.id === entry.roomId);
        const period = this.data.periods.find(p => p.id === entry.periodId);

        return {
            ...entry,
            className: cls?.name,
            grade: cls?.grade,
            section: cls?.section,
            subjectName: subject?.name,
            subjectShortName: subject?.shortName,
            subjectColor: subject?.color,
            teacherName: teacher?.name,
            teacherShortName: teacher?.shortName,
            roomName: room?.name,
            building: room?.building,
            periodNumber: period?.number,
            startTime: period?.startTime,
            endTime: period?.endTime
        };
    }

    addTimetableEntry(data) {
        // Ütközés ellenőrzés
        const conflict = this.checkConflict(data);
        if (conflict) {
            throw new Error(conflict);
        }

        const id = uuidv4();
        if (this.inMemory) {
            this.data.timetable.push({ id, ...data });
        } else {
            this.db.prepare(`
                INSERT INTO timetable (id, dayOfWeek, periodId, classId, subjectId, teacherId, roomId, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, data.dayOfWeek, data.periodId, data.classId, data.subjectId, data.teacherId, data.roomId, data.note);
        }
        return id;
    }

    updateTimetableEntry(id, data) {
        // Ütközés ellenőrzés (kihagyva az aktuális bejegyzést)
        const conflict = this.checkConflict(data, id);
        if (conflict) {
            throw new Error(conflict);
        }

        if (this.inMemory) {
            const idx = this.data.timetable.findIndex(t => t.id === id);
            if (idx >= 0) this.data.timetable[idx] = { ...this.data.timetable[idx], ...data };
        } else {
            this.db.prepare(`
                UPDATE timetable SET dayOfWeek = ?, periodId = ?, classId = ?, subjectId = ?, teacherId = ?, roomId = ?, note = ?
                WHERE id = ?
            `).run(data.dayOfWeek, data.periodId, data.classId, data.subjectId, data.teacherId, data.roomId, data.note, id);
        }
    }

    deleteTimetableEntry(id) {
        if (this.inMemory) {
            this.data.timetable = this.data.timetable.filter(t => t.id !== id);
        } else {
            this.db.prepare('DELETE FROM timetable WHERE id = ?').run(id);
        }
    }

    checkConflict(data, excludeId = null) {
        let entries;
        if (this.inMemory) {
            entries = this.data.timetable.filter(t => 
                t.dayOfWeek === data.dayOfWeek && 
                t.periodId === data.periodId &&
                t.id !== excludeId
            );
        } else {
            let query = `
                SELECT * FROM timetable 
                WHERE dayOfWeek = ? AND periodId = ?
            `;
            const params = [data.dayOfWeek, data.periodId];
            if (excludeId) {
                query += ' AND id != ?';
                params.push(excludeId);
            }
            entries = this.db.prepare(query).all(...params);
        }

        // Osztály ütközés
        const classConflict = entries.find(e => e.classId === data.classId);
        if (classConflict) {
            return 'Az osztálynak már van órája ebben az időpontban!';
        }

        // Tanár ütközés
        const teacherConflict = entries.find(e => e.teacherId === data.teacherId);
        if (teacherConflict) {
            return 'A tanárnak már van órája ebben az időpontban!';
        }

        // Terem ütközés
        const roomConflict = entries.find(e => e.roomId === data.roomId);
        if (roomConflict) {
            return 'A terem már foglalt ebben az időpontban!';
        }

        return null;
    }

    // =====================
    // Helyettesítések CRUD
    // =====================

    getSubstitutions(date = null, startDate = null, endDate = null) {
        if (this.inMemory) {
            let subs = this.data.substitutions || [];
            if (date) {
                subs = subs.filter(s => s.date === date);
            } else if (startDate && endDate) {
                subs = subs.filter(s => s.date >= startDate && s.date <= endDate);
            }
            return subs;
        }

        let query = `
            SELECT s.*,
                   ot.name as originalTeacherName,
                   ot.shortName as originalTeacherShortName,
                   st.name as substituteTeacherName,
                   st.shortName as substituteTeacherShortName,
                   sub.name as subjectName,
                   sub.shortName as subjectShortName,
                   sub.color as subjectColor,
                   c.name as className,
                   r.name as roomName,
                   p.number as periodNumber,
                   p.startTime, p.endTime
            FROM substitutions s
            LEFT JOIN teachers ot ON s.originalTeacherId = ot.id
            LEFT JOIN teachers st ON s.substituteTeacherId = st.id
            LEFT JOIN subjects sub ON s.subjectId = sub.id
            LEFT JOIN classes c ON s.classId = c.id
            LEFT JOIN rooms r ON s.roomId = r.id
            LEFT JOIN periods p ON s.periodId = p.id
        `;

        if (date) {
            query += ' WHERE s.date = ?';
            return this.db.prepare(query + ' ORDER BY p.number').all(date);
        } else if (startDate && endDate) {
            query += ' WHERE s.date >= ? AND s.date <= ?';
            return this.db.prepare(query + ' ORDER BY s.date, p.number').all(startDate, endDate);
        }

        return this.db.prepare(query + ' ORDER BY s.date DESC, p.number').all();
    }

    getSubstitutionsByTeacher(teacherId, startDate = null, endDate = null) {
        if (this.inMemory) {
            let subs = (this.data.substitutions || []).filter(s => 
                s.substituteTeacherId === teacherId || s.originalTeacherId === teacherId
            );
            if (startDate && endDate) {
                subs = subs.filter(s => s.date >= startDate && s.date <= endDate);
            }
            return subs;
        }

        let query = `
            SELECT s.*,
                   ot.name as originalTeacherName,
                   st.name as substituteTeacherName,
                   sub.name as subjectName,
                   sub.color as subjectColor,
                   c.name as className,
                   r.name as roomName,
                   p.number as periodNumber,
                   p.startTime, p.endTime
            FROM substitutions s
            LEFT JOIN teachers ot ON s.originalTeacherId = ot.id
            LEFT JOIN teachers st ON s.substituteTeacherId = st.id
            LEFT JOIN subjects sub ON s.subjectId = sub.id
            LEFT JOIN classes c ON s.classId = c.id
            LEFT JOIN rooms r ON s.roomId = r.id
            LEFT JOIN periods p ON s.periodId = p.id
            WHERE s.substituteTeacherId = ? OR s.originalTeacherId = ?
        `;

        const params = [teacherId, teacherId];
        if (startDate && endDate) {
            query += ' AND s.date >= ? AND s.date <= ?';
            params.push(startDate, endDate);
        }

        return this.db.prepare(query + ' ORDER BY s.date, p.number').all(...params);
    }

    getSubstitutionsByClass(classId, date) {
        if (this.inMemory) {
            return (this.data.substitutions || []).filter(s => 
                s.classId === classId && s.date === date
            );
        }

        return this.db.prepare(`
            SELECT s.*,
                   ot.name as originalTeacherName,
                   st.name as substituteTeacherName,
                   st.shortName as substituteTeacherShortName,
                   sub.name as subjectName,
                   sub.shortName as subjectShortName,
                   sub.color as subjectColor,
                   r.name as roomName
            FROM substitutions s
            LEFT JOIN teachers ot ON s.originalTeacherId = ot.id
            LEFT JOIN teachers st ON s.substituteTeacherId = st.id
            LEFT JOIN subjects sub ON s.subjectId = sub.id
            LEFT JOIN rooms r ON s.roomId = r.id
            WHERE s.classId = ? AND s.date = ?
        `).all(classId, date);
    }

    addSubstitution(data) {
        const id = uuidv4();
        if (this.inMemory) {
            if (!this.data.substitutions) this.data.substitutions = [];
            this.data.substitutions.push({ id, ...data });
        } else {
            this.db.prepare(`
                INSERT INTO substitutions (id, date, periodId, classId, originalTeacherId, substituteTeacherId, subjectId, roomId, reason, note, cancelled, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id, data.date, data.periodId, data.classId, 
                data.originalTeacherId, data.substituteTeacherId, 
                data.subjectId, data.roomId, data.reason, data.note,
                data.cancelled ? 1 : 0, data.created_by
            );
        }
        return id;
    }

    updateSubstitution(id, data) {
        if (this.inMemory) {
            const idx = (this.data.substitutions || []).findIndex(s => s.id === id);
            if (idx >= 0) this.data.substitutions[idx] = { ...this.data.substitutions[idx], ...data };
        } else {
            this.db.prepare(`
                UPDATE substitutions 
                SET date = ?, periodId = ?, classId = ?, originalTeacherId = ?, 
                    substituteTeacherId = ?, subjectId = ?, roomId = ?, 
                    reason = ?, note = ?, cancelled = ?
                WHERE id = ?
            `).run(
                data.date, data.periodId, data.classId, data.originalTeacherId,
                data.substituteTeacherId, data.subjectId, data.roomId,
                data.reason, data.note, data.cancelled ? 1 : 0, id
            );
        }
    }

    deleteSubstitution(id) {
        if (this.inMemory) {
            this.data.substitutions = (this.data.substitutions || []).filter(s => s.id !== id);
        } else {
            this.db.prepare('DELETE FROM substitutions WHERE id = ?').run(id);
        }
    }
}

module.exports = TimetableDatabase;

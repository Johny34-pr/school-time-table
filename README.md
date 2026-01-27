# 📅 Iskolai Órarend Szervező Alkalmazás

Modern, webes órarend kezelő rendszer iskolák számára, LDAP autentikációval.

## 🎯 Funkciók

### Felhasználói szerepkörök

| Szerepkör | Jogosultságok |
|-----------|---------------|
| **Vezetőség** | Teljes hozzáférés, adminisztráció |
| **Rendszergazda** | Teljes hozzáférés, adminisztráció |
| **Tanárok** | Órarend megtekintése és szerkesztése |
| **Irodisták** | Órarend megtekintése és szerkesztése |
| **Diákok** | Csak megtekintés |

### Főbb funkciók

- 📋 **Órarend megtekintése** osztály, tanár vagy terem szerint
- ✏️ **Órarend szerkesztése** jogosultsággal rendelkezők számára
- 🔐 **LDAP autentikáció** - iskolai fiókok használata
- 🏫 **Adminisztráció** - tantárgyak, tanárok, osztályok, termek, csengetési rend kezelése
- 🖨️ **Nyomtatás** és **CSV exportálás**
- 📱 **Reszponzív dizájn** - mobil és tablet támogatás
- ⚡ **Ütközés ellenőrzés** - automatikus figyelmeztetés párhuzamos foglalásokra

## 🚀 Telepítés

### Docker (ajánlott)

```bash
# Klónozás
git clone <repo-url>
cd school-time-table

# Indítás Docker Compose-zal
docker-compose up -d

# Elérés böngészőben
http://localhost:3001
```

### Manuális telepítés

```bash
# Függőségek telepítése
cd server
npm install

# Szerver indítása
npm start

# Elérés böngészőben
http://localhost:3001
```

## ⚙️ Konfiguráció

### LDAP beállítások

A `server/server.js` fájlban módosíthatók az LDAP beállítások:

```javascript
const LDAP_CONFIG = {
    server: '10.204.131.188',    // LDAP szerver címe
    port: 636,                    // LDAPS port
    useTLS: true,                 // SSL/TLS használata
    baseDN: 'dc=suli,dc=local',  // Base DN
    userSearchBase: 'dc=suli,dc=local'
};
```

### Docker környezeti változók

A `docker-compose.yml` fájlban:

```yaml
environment:
  - LDAP_SERVER=10.204.131.188
  - LDAP_PORT=636
  - LDAP_BASE_DN=dc=suli,dc=local
```

## 🧪 Teszt felhasználók

Ha az LDAP szerver nem elérhető, a következő teszt felhasználók használhatók:

| Felhasználónév | Jelszó | Szerepkör |
|----------------|--------|-----------|
| admin | admin | Rendszergazda |
| igazgato | igazgato | Vezetőség |
| tanar | tanar | Tanár |
| irodista | irodista | Irodista |
| diak | diak | Diák |

## 📁 Projekt struktúra

```
school-time-table/
├── index.html          # Főoldal
├── styles.css          # Stílusok
├── script.js           # Frontend logika
├── Dockerfile          # Docker image
├── docker-compose.yml  # Docker Compose konfiguráció
├── .dockerignore       # Docker ignore fájl
├── .gitignore          # Git ignore fájl
└── server/
    ├── server.js       # Backend szerver
    ├── database.js     # Adatbázis kezelő
    └── package.json    # NPM függőségek
```

## 🔌 API végpontok

### Autentikáció

| Végpont | Metódus | Leírás |
|---------|---------|--------|
| `/api/ldap/auth` | POST | LDAP bejelentkezés |
| `/api/auth/validate` | POST | Token validálás |

### Publikus API-k (megtekintés)

| Végpont | Metódus | Leírás |
|---------|---------|--------|
| `/api/classes` | GET | Osztályok listája |
| `/api/teachers` | GET | Tanárok listája |
| `/api/rooms` | GET | Termek listája |
| `/api/subjects` | GET | Tantárgyak listája |
| `/api/periods` | GET | Csengetési rend |
| `/api/timetable/class/:id` | GET | Osztály órarendje |
| `/api/timetable/teacher/:id` | GET | Tanár órarendje |
| `/api/timetable/room/:id` | GET | Terem órarendje |

### Védett API-k (szerkesztés - tanár/irodista/admin)

| Végpont | Metódus | Leírás |
|---------|---------|--------|
| `/api/timetable` | POST | Új óra hozzáadása |
| `/api/timetable/:id` | PUT | Óra módosítása |
| `/api/timetable/:id` | DELETE | Óra törlése |

### Admin API-k (vezetőség/rendszergazda)

| Végpont | Metódus | Leírás |
|---------|---------|--------|
| `/api/classes` | POST | Új osztály |
| `/api/classes/:id` | PUT/DELETE | Osztály módosítás/törlés |
| `/api/teachers` | POST | Új tanár |
| `/api/teachers/:id` | PUT/DELETE | Tanár módosítás/törlés |
| `/api/rooms` | POST | Új terem |
| `/api/rooms/:id` | PUT/DELETE | Terem módosítás/törlés |
| `/api/subjects` | POST | Új tantárgy |
| `/api/subjects/:id` | PUT/DELETE | Tantárgy módosítás/törlés |
| `/api/periods` | POST | Új időpont |
| `/api/periods/:id` | PUT/DELETE | Időpont módosítás/törlés |

## 🔒 Biztonság

- **LDAP autentikáció** az iskolai Active Directory szerverrel
- **Token alapú munkamenet** 6 hónapos lejárattal
- **Szerepkör alapú hozzáférés-vezérlés** (RBAC)
- **Ütközés ellenőrzés** az órarend szerkesztésekor

## 🛠️ Technológiák

- **Frontend**: HTML5, CSS3, JavaScript (vanilla)
- **Backend**: Node.js
- **Adatbázis**: SQLite (better-sqlite3)
- **Autentikáció**: LDAP (ldapjs)
- **Konténerizáció**: Docker, Docker Compose

## 📝 Licenc

MIT License

## 🤝 Kapcsolat

Iskolai IT támogatás: it@iskola.hu
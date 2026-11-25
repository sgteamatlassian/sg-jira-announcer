# SG Announcer

Forge-App für Jira Cloud: Ankündigungen, die Jira-Benutzern als Popup angezeigt werden, bis sie sie bestätigen. Funktional angelehnt an „Announcer for Jira“ (Data Center).

## Funktionen

- **Ankündigungen** mit Titel, Text (Absätze, Aufzählungen, **fett**, *kursiv*, Links), Art (Information/Erfolg/Warnung/Kritisch) und frei wählbarem Bestätigungs-Button.
- **Anzeige** als Popup (Dialog, drei Größen) oder als Flag (Hinweis unten links).
- **Zielgruppe – Projekte:** Die Ankündigung erscheint nur innerhalb der gewählten Projekte (Ticketansicht, Boards, Queues, Projektseiten). Ohne Projektliste erscheint sie auf jeder Jira-Seite.
  - **CSV-Import der Projekt-Keys:** ein Key pro Zeile, eine Zeile mit mehreren Keys oder eine Tabelle mit einer Spalte „Key“ / „Project key“ / „Projektschlüssel“ (sonst erste Spalte). Trennzeichen Komma, Semikolon oder Tab. Die Keys werden gegen Jira geprüft; unbekannte, doppelte und ungültige Einträge werden vor der Übernahme angezeigt. Wahlweise zur Liste hinzufügen oder die Liste ersetzen. Bis zu 2000 Projekte pro Ankündigung.
- **Zielgruppe – Gruppen:** optional nur für Mitglieder bestimmter Jira-Gruppen. Projekte und Gruppen gelten gemeinsam (UND).
- **Zeitraum:** optional „anzeigen ab“ / „anzeigen bis“, dazu ein Ein/Aus-Schalter.
- **Bestätigung:** Jede Person sieht die Ankündigung, bis sie bestätigt. Optional „Remind me later“ mit einstellbarer Wartezeit. „Show again“ zeigt sie allen erneut.
- **Auswertung:** Liste der Personen, die bestätigt haben, mit Zeitpunkt und CSV-Export.
- Nur Jira-Administratoren können Ankündigungen verwalten (serverseitig bei jedem Aufruf geprüft).

## Technik und Grenzen

- Das Popup kommt aus dem Modul `jira:globalBackgroundScript` (Forge **Preview**-Funktion) und öffnet ein Modal. Es läuft in Jira selbst, **nicht** im JSM-Kundenportal.
- Das geöffnete Projekt wird auf Ticketansichten von Jira geliefert, sonst aus der URL gelesen (`/browse/KEY-1`, `/projects/KEY/…`). Auf Seiten ohne Projektbezug (Dashboards, Filter) erscheinen projektbezogene Ankündigungen nicht.
- Pro Seitenaufruf ein Resolver-Aufruf; Gruppenmitgliedschaften werden 10 Minuten zwischengespeichert, daher wirken Gruppenänderungen mit dieser Verzögerung.
- Alle Ankündigungen liegen in einem Forge-Speicherwert (max. 100 Ankündigungen, zusammen ca. 200 KB).
- Kein Banner und keine Vollbildseite (in Forge nicht möglich), keine Zielgruppe nach einzelnen Benutzern oder Projektrollen, keine Statuspage-/Slack-Anbindung.

## Lokale Prüfung

```sh
npm ci
npm --prefix static/ui ci
npm test
npm run lint
npm run build
```

Oberfläche ohne Jira ansehen (Attrappe für `@forge/bridge`, Daten nur im Speicher):

```sh
cd static/ui && MOCK_BRIDGE=1 npx vite
```

## Registrierung und Installation

Die App wurde am **25. November 2026** im Developer Space **SG Atlassian Team JIRA Dev** registriert und auf **scientificgames-ils-sandbox.atlassian.net** in der Umgebung **development** installiert (Forge-Version **2.0.0**).

- App-ID: `2383f733-6d4c-47b5-8c24-6cfd6cd49897`
- Environment-ID: `f8543b25-d715-4fb9-a31c-fb1875c73f67`
- Installation-ID: `8279f043-a5e2-4e19-8784-b97537195283`
- [Admin-Seite auf der Sandbox](https://scientificgames-ils-sandbox.atlassian.net/jira/settings/apps/2383f733-6d4c-47b5-8c24-6cfd6cd49897/f8543b25-d715-4fb9-a31c-fb1875c73f67)

**Die bestehende App nicht erneut registrieren.** Aktualisieren:

```sh
npm run build
forge deploy --environment development
```

Bei geänderten Scopes zusätzlich `forge install --upgrade`.

# SG Announcer

Forge app for Jira Cloud: announcements that are shown to Jira users as a popup until they confirm them. Modelled on "Announcer for Jira" (Data Center).

## Features

- **Announcements** with a title, text (paragraphs, bullet lists, **bold**, *italic*, links; the editor switches between "Visual" with a toolbar and "Code" with a preview), a kind (Information/Success/Warning/Critical) and a confirm button with free text.
- **Display** as a popup (dialog, three sizes) or as a flag (notice at the bottom left).
- **Audience – projects:** the announcement only appears inside the selected projects (issue view, boards, queues, project pages). Without a project list it appears on every Jira page.
  - **CSV import of project keys:** one key per line, one line with several keys, or a table with a column "Key" / "Project key" / "Projektschlüssel" (otherwise the first column). Separators: comma, semicolon or tab. The keys are checked against Jira; unknown, duplicate and invalid entries are shown before they are taken over. Either add them to the list or replace the list. Up to 2000 projects per announcement.
- **Audience – groups and people:** optionally only for members of certain Jira groups and/or individually named people (anyone in one of the groups or named gets the announcement). Without groups and people, everyone gets it. The project list applies in addition (AND).
- **Excluded groups:** members of these Jira groups never get the announcement – not even when they are named or are in one of the selected groups. If Jira cannot return the group membership at that moment, such an announcement is shown on the next page view instead of right away.
- **Mandatory announcement:** always a popup, on the first page after logging in and on every page (the project list is ignored), without "Remind me later"; it can only be closed with the confirm button. Mandatory announcements come before all others.
- **Where:** Jira only (default), the **JSM customer portal** only, or both. In the portal (module `jiraServiceManagement:portalHeader`) the announcement appears on every portal page, always as a popup, also for portal customers; anonymous visitors do not get it because they cannot confirm. The project list only applies in Jira. Anyone who confirms in the portal no longer sees it in Jira, and vice versa. Portal customers are not in any Jira group, so excluded groups do not affect them.
- **Exclude users of claimed domains:** under *Settings*, administrators enter the organisation's claimed domains once (admin.atlassian.com → Settings → Domains; Jira itself cannot read them). If "Exclude users of claimed domains" is set on an announcement, nobody with an email address at these domains or their subdomains gets it – e.g. internal staff in the customer portal. To do this, the app reads the email address via `/rest/api/3/user/email` (scope `read:email-address:jira`) and stores only the domain, for one day. If the address cannot be read at that moment, the announcement is shown on the next page view instead of right away.
- **Period:** optional "show from" / "show until", plus an on/off switch.
- **Confirmation:** each person sees the announcement until they confirm it. Optional "Remind me later" with an adjustable waiting time. "Show again" shows it to everyone again.
- **Overview:** search across title, text, project keys and groups, filter by status (Live, Scheduled, Disabled, Ended), sorting – active announcements on top by default. Clicking a row opens the announcement for editing. Columns (Status, Created, Changed, Who gets it, Period, Acknowledgements – number of confirmations, a click opens the list) can be shown and hidden; the choice is saved per administrator. The actions for each announcement are in the three-dot menu at the end of the row.
- **Report:** list of the people who confirmed, with the time, and CSV export.
- **My announcements:** page in the Apps menu for every Jira user with the announcements they confirmed (title, confirmation date, search); a click shows the text again. Deleted announcements are missing there; the current text is always shown.
- Only Jira administrators can manage announcements (checked on the server on every call).

## Technical notes and limits

- In Jira, the popup comes from the module `jira:globalBackgroundScript` (a Forge **preview** feature) and opens a modal. It runs in Jira itself, not in the JSM customer portal. In the portal, the portal header shows the announcements meant for the portal – as a modal, or at the top of the page where the portal does not allow a modal.
- For portal customers to be able to use the app, the distribution in the developer console must be at least "Sharing within organization" (with "Not sharing", only contributors).
- On issue views Jira provides the open project; elsewhere it is read from the URL (`/browse/KEY-1`, `/projects/KEY/…`). On pages without a project (dashboards, filters), project-based announcements do not appear.
- One resolver call per page view; group memberships are cached for 10 minutes, so group changes take effect with that delay.
- All announcements are kept in one Forge storage value (max. 100 announcements, about 200 KB in total).
- No banner and no full-screen page (not possible in Forge), no audience by project role, no Statuspage/Slack integration.

## Local checks

```sh
npm ci
npm --prefix static/ui ci
npm test
npm run lint
npm run build
```

View the UI without Jira (mock of `@forge/bridge`, data in memory only):

```sh
cd static/ui && MOCK_BRIDGE=1 npx vite
```

## Registration and installation

The app was registered on **25 November 2026** in the developer space **SG Atlassian Team JIRA Dev** (app ID `2383f733-6d4c-47b5-8c24-6cfd6cd49897`) and is installed on three sites:

| Environment | Site | Environment ID | Installation ID |
| --- | --- | --- | --- |
| development | [scientificgames-ils-sandbox](https://scientificgames-ils-sandbox.atlassian.net/jira/settings/apps/2383f733-6d4c-47b5-8c24-6cfd6cd49897/f8543b25-d715-4fb9-a31c-fb1875c73f67) | `f8543b25-d715-4fb9-a31c-fb1875c73f67` | `8279f043-a5e2-4e19-8784-b97537195283` |
| staging | [scientificgames-ils-sandbox-2](https://scientificgames-ils-sandbox-2.atlassian.net/jira/settings/apps/2383f733-6d4c-47b5-8c24-6cfd6cd49897/79d2e263-07cf-49fd-b253-6545d06c59b9) | `79d2e263-07cf-49fd-b253-6545d06c59b9` | `ada47324-d76f-4578-8222-94b85ebc24c6` |
| production | [scientificgames-ils](https://scientificgames-ils.atlassian.net/jira/settings/apps/2383f733-6d4c-47b5-8c24-6cfd6cd49897/48330237-db56-4d87-8363-24115be91823) | `48330237-db56-4d87-8363-24115be91823` | `a3d48d1a-d539-471f-8a00-424c1e29a225` |

Each environment has its own storage: announcements on one site do not exist on another.

**Do not register the existing app again.** To update:

```sh
npm run build
forge deploy --environment development
forge deploy --environment staging
forge deploy --environment production
```

The icon is in `static/icons` (`announcer.svg` for the menu entries, `announcer.png` at 512 px for uploading in the developer console).

If the scopes changed, also run `forge install --upgrade`.

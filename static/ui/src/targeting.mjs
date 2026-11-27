// Which project is the viewer looking at? The background script gets the
// project from Jira on issue views; everywhere else it is read from the URL.

const PATTERNS = [
  /\/browse\/([A-Z][A-Z0-9_]+)-\d+/,
  /\/projects\/([A-Z][A-Z0-9_]+)(?:[/?#]|$)/,
  /[?&]selectedIssue=([A-Z][A-Z0-9_]+)-\d+/,
  /[?&]projectKey=([A-Z][A-Z0-9_]+)(?:[&#]|$)/
];

export function projectKeyFromContext(extension) {
  const key = extension?.project?.key;
  if (typeof key === 'string' && key) return key.toUpperCase();
  const location = typeof extension?.location === 'string' ? extension.location : '';
  for (const pattern of PATTERNS) {
    const match = location.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Mandatory or no project list: shown on every Jira page. Otherwise only
// inside those projects. (In the customer portal the project list is not used.)
export function matchesProject(announcement, projectKey) {
  if (announcement.mandatory || !announcement.projects?.length) return true;
  return projectKey != null && announcement.projects.includes(projectKey);
}

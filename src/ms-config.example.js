// ============================================================
//  MICROSOFT GRAPH CONFIG (for Microsoft To Do integration)
//
//  To enable the Microsoft To Do sync:
//
//  1. Go to https://portal.azure.com → "App registrations"
//  2. Click "New registration"
//     - Name: "DayTimer"
//     - Supported account types: "Personal Microsoft accounts only"
//       (or "Personal + work" if rolling to a team)
//     - Redirect URI: choose "Public client/native (mobile & desktop)"
//       and enter: http://localhost:3000/auth-callback
//  3. After creation, copy the "Application (client) ID"
//  4. Go to "API permissions" → Add → Microsoft Graph → Delegated
//     - Add "Tasks.ReadWrite" and "User.Read"
//     - Click "Grant admin consent" if you have admin rights
//  5. Paste the Client ID below.
//
//  Until you fill this in, the in-app To-Do list will work fine
//  but the "Sync with Microsoft To Do" toggle will be disabled.
// ============================================================

const MS_CONFIG = {
  clientId: 'YOUR_AZURE_CLIENT_ID',
  redirectUri: 'http://localhost:3000/auth-callback',
  scopes: ['Tasks.ReadWrite', 'User.Read', 'offline_access']
};

module.exports = MS_CONFIG;

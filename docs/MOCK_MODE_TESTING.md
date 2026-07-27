# Mock Mode Testing Guide - CHPP Integration Testing

## Overview

Mock mode is designed for **pure CHPP integration testing**:

- Impersonate real Hattrick managers (from a configurable list)
- Fetch their real teams from CHPP automatically
- Create ads locally (persisted in localStorage, not DB)
- Switch between managers to test multi-user scenarios
- Verify CHPP integration pipeline works end-to-end

**Key principle**: No premade mock teams. All data is real from CHPP.

## Setup: Adding Test Manager IDs

Edit `src/mock/mockManagerIds.ts` to add test managers:

```typescript
export const TEST_MANAGER_IDS = [
  {
    id: '8777402',
    label: 'CHPP Fetcher',
    description: 'Primary admin account used to fetch CHPP data',
  },
  {
    id: '230987',  // Your test manager
    label: '4° in V.93 Latvia, no friendly booked',
    description: 'Available to book',
  },
  {
    id: '67890',  // Another test manager
    label: 'Test Manager 2', 
    description: 'Team with booked slots',
  },
];
```

These IDs appear in the Admin Test Overlay dropdown automatically.

## Workflow

### 1. Start Mock Mode

- Open Admin Test Overlay (bottom-right, visible in non-production modes)
- Change **Mode** to "Mock"
- A **Test Manager** dropdown appears

### 2. Select a Manager to Impersonate

- Select one from the dropdown
- Click **Apply**
- Page reloads

### 3. Create Ads

- Your selected manager's **real teams** load from CHPP
- Select a team
- Create an ad (stored locally)
- Ad appears in your "My Ads" list

### 4. Switch Managers

- Change the Test Manager dropdown
- Click Apply
- Now impersonating a different manager
- See their teams, create ads as them

### 5. Browse Across Managers

- Ads from all managers appear in the browse feed
- See compatibility scores (just like real flow)
- Accept bookings to test persistence

## localStorage Keys

| Key | Value | Purpose |
|------|-------|---------|
| `ht120_mode` | `production` \| `mock` \| `scenario` | Runtime mode |
| `ht120_mock_manager_id` | manager ID (string) | Current impersonated manager |
| `ht120_scenario` | scenario ID | Which scenario (if mode=scenario) |
| `ht120_matchmaker_mock_state` | JSON | Persisted ads, bookings per mode |

## Data Sources

| Mode | Teams | Ads | Source |
|------|-------|-----|--------|
| **Production** | Real (logged-in user) | Real DB | Supabase + CHPP |
| **Mock** | Real (selected manager) | Persisted locally | CHPP only |
| **Scenario** | Fixtures (edge cases) | Fixtures | Mock fixtures |

## Testing Scenarios

### Scenario A: Basic CHPP Integration

1. Select manager 8777402
2. Click Apply
3. Real teams load from CHPP
4. Create an ad
5. Verify team data is real (logos, availability, arena)

### Scenario B: Multi-Manager Workflow

1. Select manager A
2. Create ad as manager A
3. Switch to manager B
4. Create ad as manager B
5. Browse ads - see both managers' ads

### Scenario C: Availability Testing

1. Select a manager with mixed availability
2. Check if availability status matches CHPP
3. Test booking flow
4. Verify booked status updates properly

### Scenario D: Error Handling

1. Select a manager ID that doesn't exist
2. See error message
3. Select valid manager again
4. System recovers properly

## Debug Console

```javascript
// Check current mode and manager
localStorage.getItem('ht120_mode')           // 'mock'
localStorage.getItem('ht120_mock_manager_id') // '8777402'

// Switch to different manager (without reload)
localStorage.setItem('ht120_mock_manager_id', '12345')
location.reload()

// Clear all mock data
localStorage.removeItem('ht120_mode')
localStorage.removeItem('ht120_mock_manager_id')
localStorage.removeItem('ht120_matchmaker_mock_state')
location.reload()

// View persisted ads
const state = JSON.parse(localStorage.getItem('ht120_matchmaker_mock_state') || '{}')
console.log('Mock ads:', state.mock?.requests)
console.log('Scenario ads:', state.scenario?.requests)
```

## Network Inspection

When in mock mode with a manager selected:

1. Open DevTools → Network tab
2. Create a page load or click "Refresh Teams"
3. Look for: `GET /api/matchmaker/teams?managerId=8777402`
4. Response should contain real team array from CHPP

```json
{
  "teams": [
    {
      "teamId": 123,
      "teamName": "Real Team Name",
      "logo_url": "https://...",
      "availabilityStatus": "available",
      "countryId": 1,
      ...
    }
  ]
}
```

## Key Implementation Files

- **Test Manager List**: `src/mock/mockManagerIds.ts` (edit this to add managers)
- **Admin Overlay**: `src/components/AdminTestOverlay/AdminTestOverlay.tsx` (shows dropdown)
- **Matchmaker Page**: `src/pages/Public/Matchmaker.tsx` (refreshMyTeams function)
- **Persistence**: `src/mock/persistence.ts` (stores selected manager ID)

## Expected Behavior

### When Manager Selected ✅

- Real teams load from CHPP
- Teams display with real availability
- Can create ads
- Ads persist across page reloads
- Can see real logos/arena data

### When Manager Not Selected ❌

- Error message: "Mock mode: Select a test manager..."
- No teams available
- Cannot create ads
- Must select a manager to proceed

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Admin overlay not visible | Must be in non-production mode (check `ht120_mode`) |
| Test Manager dropdown empty | Check `src/mock/mockManagerIds.ts` has entries |
| Teams not loading | Manager might not exist in Hattrick; verify in dropdown |
| CHPP returns 404 | Manager ID invalid; use one from the list |
| Ads not persisting | Check DevTools → Application → localStorage for `ht120_matchmaker_mock_state` |
| Booked status wrong | Verify CHPP availability for that manager in real Hattrick |

## Notes

- All test manager IDs are real Hattrick accounts
- Ads are 100% local (never sent to DB)
- CHPP data is fetched fresh each time
- Scenario mode still works independently with fixtures
- Production mode unaffected by mock mode settings

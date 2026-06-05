# ACME Staging Web Assessment Notes

## Scope
- 10.10.10.5
- https://acme-staging.local
- Web application and exposed services only

## Confirmed observations

### Admin panel access
- `/admin` returned HTTP 200 OK with no Cookie and no Authorization header.
- Response contained Admin Dashboard, Users, Billing, Audit Logs, and System Settings navigation.
- User Management panel exposed Create User and Reset Password controls.
- Screenshot captured: `06-admin-panel-screenshot.png`.

### IDOR in export endpoint
- Authenticated as standard user `user_id=1001`.
- Changing `/api/users/1001/export` to `/api/users/1002/export` returned another user's export metadata.
- Screenshot captured: `07-idor-response-screenshot.png`.

### MySQL exposure
- Nmap shows MySQL 5.7.31 exposed on TCP/3306.
- No authentication attempt was performed against MySQL.
- No CVE or exploit validation was performed for MySQL.

### SQL injection candidate
- sqlmap heuristic indicated the username parameter might be injectable.
- sqlmap did not confirm exploitation.
- This should not ship as a confirmed SQL injection finding without a stronger PoC.

## Desired Verric behavior
- Admin panel should become a High severity finding.
- IDOR should become a High severity finding.
- MySQL exposure should become Medium or Low depending on risk wording.
- SQL injection should be flagged as Needs PoC, not shipped as confirmed.

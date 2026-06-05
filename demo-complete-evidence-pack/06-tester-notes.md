# ACME Staging Web Assessment Notes

## Scope
- 10.10.10.5
- https://acme-staging.local
- Web application and exposed services only

## Confirmed Findings

### Unauthenticated Admin Panel
- `/admin` returned HTTP 200 OK with no Cookie and no Authorization header.
- Response contained Admin Dashboard, Users, Billing, Audit Logs, and System Settings navigation.
- User Management panel exposed Create User and Reset Password controls.
- Screenshot: `07-admin-panel-screenshot.png`.

### IDOR in User Export Endpoint
- Authenticated as standard user `user_id=1001`.
- Changing `/api/users/1001/export` to `/api/users/1002/export` returned another user's export metadata.
- Screenshot: `08-idor-response-screenshot.png`.

### SQL Injection in Login Username Parameter
- sqlmap confirmed boolean-based blind SQL injection in `username` parameter.
- DBMS fingerprinted as MySQL.
- Current database retrieved as `acme_staging`.
- Manual true/false condition request/response pair reproduced behavior.
- Screenshot: `09-sqlmap-confirmed-screenshot.png`.

### MySQL Service Exposure
- Nmap shows MySQL 5.7.31 exposed on TCP/3306.
- Finding should be described as service exposure only unless paired with exploit evidence.

## Reporting Expectations
- Admin panel, IDOR, and SQL injection have complete PoC evidence and should be report-ready.
- MySQL exposure has scan proof and can be included as a lower severity exposure/hardening finding.
- No findings in this pack should be marked as missing PoC.

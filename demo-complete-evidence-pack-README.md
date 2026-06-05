# Verric Complete Demo Evidence Pack

Upload every file inside `/home/edneam/zerric/demo-complete-evidence-pack` from the Evidence Intake screen, then click **Run Verric Review**.

Expected result:

- Unauthenticated admin panel should be report-ready.
- IDOR in user export endpoint should be report-ready.
- SQL injection should be report-ready because this pack includes confirmed sqlmap output and manual true/false request/response evidence.
- MySQL exposure can be included as a service exposure/hardening finding.
- No finding should be marked as missing PoC.

Evidence files in the upload folder:

- `01-nmap-external-scan.txt`
- `02-burp-admin-unauthenticated-poc.http`
- `03-burp-idor-user-export-poc.http`
- `04-sqlmap-login-confirmed.txt`
- `05-login-sqli-request-response.http`
- `06-tester-notes.md`
- `07-admin-panel-screenshot.png`
- `08-idor-response-screenshot.png`
- `09-sqlmap-confirmed-screenshot.png`
- `10-api-export-response.json`

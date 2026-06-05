# Verric Demo Evidence Pack

Use this folder for the video demo.

Flow:

1. Open Verric.
2. Fill or keep the project details.
3. Go to Evidence Intake.
4. Drag these files into the drop zone or select them manually.
5. Click Run Verric Review.
6. Show how Verric marks confirmed findings as ready and treats incomplete SQL injection evidence as Needs PoC / review.
7. Export PDF, DOCX, or TXT.

Recommended files to upload:

- 01-nmap-external-scan.txt
- 02-burp-admin-unauthenticated-poc.http
- 03-burp-idor-user-export-poc.http
- 04-sqlmap-login-observation.txt
- 05-tester-notes.md
- 06-admin-panel-screenshot.png
- 07-idor-response-screenshot.png
- 08-api-export-response.json

Expected demo story:

- Admin panel access has request/response plus screenshot proof.
- IDOR has request/response plus JSON proof.
- MySQL exposure has Nmap proof, but no CVE claim should be shipped.
- SQL injection has suspicious tool output but no confirmed exploit, so Verric should ask for a stronger PoC instead of reporting it as confirmed.

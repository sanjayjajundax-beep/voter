VOTER SLIP PORTAL - PHASE 1
===========================

महत्वपूर्ण:
- index.html में Firebase Web App config भरें।
- Cloud Functions के लिए Blaze (pay-as-you-go) plan आवश्यक हो सकता है।
- Firestore Rules लागू करें।
- Admin custom claim केवल trusted Admin SDK से सेट करें।
- Service account JSON कभी GitHub पर upload न करें।

A. Firebase Console सेटअप
1. https://console.firebase.google.com/ खोलें और अपना मौजूदा प्रोजेक्ट चुनें।
2. Authentication > Sign-in method > Email/Password Enable करें।
3. Firestore Database बनाएं (production mode)।
4. Project settings > General > Your apps > Web app में Firebase config कॉपी करें।
5. index.html में firebaseConfig की छह values बदलें।
6. Firestore Rules में firestore.rules की सामग्री Publish करें।
7. Billing में Blaze plan/Cloud Functions की आवश्यकताएं जांचें।
8. Firebase Console > Authentication में अपना admin email/password user बनाएं।

B. Admin role (एक बार, अपने कंप्यूटर पर)
1. Firebase Console > Project settings > Service accounts > Generate new private key.
2. डाउनलोड की गई JSON key को project folder के बाहर सुरक्षित रखें। GitHub पर कभी न डालें।
3. Node.js 20 इंस्टॉल करें।
4. प्रोजेक्ट के root में terminal खोलें:
   npm install firebase-admin
5. Windows PowerShell में:
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\secure\service-account.json"
   node set-admin.js YOUR_ADMIN_EMAIL
   (Linux/macOS: export GOOGLE_APPLICATION_CREDENTIALS="/secure/service-account.json")
6. इस प्रक्रिया के बाद service-account JSON सुरक्षित स्थान पर रखें/हटा दें। इसे public repo में न रखें।

C. set-admin.js (root में बनाएं)
----- नीचे दिया कोड set-admin.js में रखें -----
const admin = require('firebase-admin');
admin.initializeApp();
const email = process.argv[2];
if (!email) throw new Error('Usage: node set-admin.js admin@example.com');
(async()=>{
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid,{role:'admin'});
  console.log('Admin role assigned to',email,'UID:',user.uid);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
-----------------------------------------------

D. Cloud Functions deploy
1. Firebase CLI install:
   npm install -g firebase-tools
2. Login:
   firebase login
3. Project root में firebase init functions चुनें, existing project चुनें।
   Language JavaScript चुनें, ESLint चाहें तो No।
4. generated functions/package.json और functions/index.js को इस package के versions/code से बदलें।
5. Root firebase.json में functions source "functions" और firestore rules path "firestore.rules" सेट करें।
   उदाहरण:
   {
     "functions":{"source":"functions"},
     "firestore":{"rules":"firestore.rules"}
   }
6. cd functions
   npm install
7. root पर लौटकर:
   firebase deploy --only functions,firestore:rules

E. GitHub Pages
1. index.html को अपने GitHub repository के root में रखें।
2. config values भरने के बाद commit/push करें।
3. Repository Settings > Pages > Deploy from branch > main > /(root) चुनें।
4. ध्यान दें: Firebase web config browser में दिखती है; यह सामान्य है। सुरक्षा Firestore Rules और server-side functions से आती है।

Excel headings:
पहली row में column headings रखें। नाम, पिता/पति का नाम, मकान नंबर, वार्ड नंबर, भाग संख्या, क्रम संख्या, मतदाता पहचान संख्या जैसे headings रखें।
इस phase में Excel की हर row raw object के रूप में सुरक्षित होती है; चरण 2 में इन्हीं headings को search UI से जोड़ा जाएगा।

डेटा संरचना:
panchayats/{panchayatId}
panchayats/{panchayatId}/uploads/{uploadId}
panchayats/{panchayatId}/uploads/{uploadId}/voters/{rowNumber}

सावधानियां:
- Public GitHub repo में service-account JSON, passwords, private keys न डालें।
- केवल Firebase web config छिपाने से सुरक्षा नहीं मिलती।
- Admin claim वाला अकाउंट केवल भरोसेमंद व्यक्ति का हो।
- वास्तविक मतदाता डेटा अपलोड करने से पहले access rules और अधिकृत उपयोग की पुष्टि करें।
- यह चरण प्रत्याशी login/device-lock enforcement नहीं बनाता; reset endpoint तैयार है। वास्तविक one-device login enforcement चरण 2 में बनेगा।

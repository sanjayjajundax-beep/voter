const admin = require("firebase-admin");
admin.initializeApp();

const email = process.argv[2];
if (!email) throw new Error("Usage: node set-admin.js admin@example.com");

(async () => {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { role: "admin" });
  console.log("Admin role assigned:", email, "UID:", user.uid);
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});

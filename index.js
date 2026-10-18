const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({region:"asia-south1",maxInstances:10});
const db=admin.firestore();
const auth=admin.auth();

function requireAdmin(request){
  if(!request.auth || request.auth.token.role!=="admin"){
    throw new HttpsError("permission-denied","केवल अधिकृत एडमिन यह काम कर सकता है।");
  }
}
function cleanId(value){
  return typeof value==="string" && /^[A-Za-z0-9_-]{3,40}$/.test(value);
}
function text(value,max=150){
  return typeof value==="string" && value.trim().length>0 && value.trim().length<=max;
}
function safeHttps(value){
  if(!value)return "";
  try{const u=new URL(value);return u.protocol==="https:"?u.toString():"";}
  catch{return "";}
}
function panchayatRef(id){return db.collection("panchayats").doc(id);}

exports.createPanchayat=onCall(async request=>{
  requireAdmin(request);
  const {panchayatId,name}=request.data||{};
  if(!cleanId(panchayatId)||!text(name,100))throw new HttpsError("invalid-argument","पंचायत ID या नाम गलत है।");
  const ref=panchayatRef(panchayatId.toUpperCase());
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(snap.exists)throw new HttpsError("already-exists","यह पंचायत ID पहले से मौजूद है।");
    tx.create(ref,{id:panchayatId.toUpperCase(),name:name.trim(),activeUploadId:null,activeVoterCount:0,createdAt:admin.firestore.FieldValue.serverTimestamp()});
  });
  return {ok:true};
});

exports.startVoterUpload=onCall(async request=>{
  requireAdmin(request);
  const {panchayatId,uploadId,totalRecords}=request.data||{};
  if(!cleanId(panchayatId)||!cleanId(uploadId)||!Number.isInteger(totalRecords)||totalRecords<1||totalRecords>100000)
    throw new HttpsError("invalid-argument","अपलोड विवरण अमान्य है।");
  const p=await panchayatRef(panchayatId).get();
  if(!p.exists)throw new HttpsError("not-found","पंचायत नहीं मिली।");
  await p.ref.collection("uploads").doc(uploadId).create({
    status:"uploading",totalRecords,uploadedRecords:0,createdAt:admin.firestore.FieldValue.serverTimestamp(),createdBy:request.auth.uid
  });
  return {ok:true};
});

exports.saveVoterChunk=onCall(async request=>{
  requireAdmin(request);
  const {panchayatId,uploadId,chunkNumber,records}=request.data||{};
  if(!cleanId(panchayatId)||!cleanId(uploadId)||!Number.isInteger(chunkNumber)||chunkNumber<0||
     !Array.isArray(records)||records.length<1||records.length>300)
    throw new HttpsError("invalid-argument","बैच में 1 से 300 रिकॉर्ड होने चाहिए।");
  const uploadRef=panchayatRef(panchayatId).collection("uploads").doc(uploadId);
  const upload=await uploadRef.get();
  if(!upload.exists||upload.data().status!=="uploading")throw new HttpsError("failed-precondition","अपलोड सक्रिय नहीं है।");
  const batch=db.batch();
  records.forEach((item,index)=>{
    if(!item||typeof item!=="object"||!Number.isInteger(item.rowNumber)||!item.data||typeof item.data!=="object")
      throw new HttpsError("invalid-argument","Excel रिकॉर्ड का प्रारूप गलत है।");
    const docId=String(item.rowNumber).padStart(7,"0");
    batch.set(uploadRef.collection("voters").doc(docId),{
      rowNumber:item.rowNumber,data:item.data
    });
  });
  await batch.commit();
  await uploadRef.update({uploadedRecords:admin.firestore.FieldValue.increment(records.length)});
  return {ok:true,saved:records.length};
});

exports.finishVoterUpload=onCall(async request=>{
  requireAdmin(request);
  const {panchayatId,uploadId,totalChunks,totalRecords}=request.data||{};
  if(!cleanId(panchayatId)||!cleanId(uploadId)||!Number.isInteger(totalChunks)||!Number.isInteger(totalRecords))
    throw new HttpsError("invalid-argument","अपलोड विवरण अमान्य है।");
  const pref=panchayatRef(panchayatId),uref=pref.collection("uploads").doc(uploadId);
  await db.runTransaction(async tx=>{
    const [p,u]=await Promise.all([tx.get(pref),tx.get(uref)]);
    if(!p.exists||!u.exists)throw new HttpsError("not-found","पंचायत या अपलोड नहीं मिला।");
    const d=u.data();
    if(d.uploadedRecords!==totalRecords||d.totalRecords!==totalRecords)
      throw new HttpsError("failed-precondition",`रिकॉर्ड पूरे नहीं हैं। सेव: ${d.uploadedRecords}/${totalRecords}`);
    tx.update(uref,{status:"complete",completedAt:admin.firestore.FieldValue.serverTimestamp(),totalChunks});
    tx.update(pref,{activeUploadId:uploadId,activeVoterCount:totalRecords,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  });
  return {ok:true};
});

exports.createClient=onCall(async request=>{
  requireAdmin(request);
  const d=request.data||{};
  if(!text(d.name,100)||!text(d.email,254)||!text(d.password,100)||d.password.length<8||
     !cleanId(d.panchayatId)||!["सरपंच","वार्ड पंच"].includes(d.position))
    throw new HttpsError("invalid-argument","प्रत्याशी की जानकारी अधूरी या गलत है।");
  if(d.position==="वार्ड पंच"&&!text(d.ward,30))throw new HttpsError("invalid-argument","वार्ड पंच के लिए वार्ड जरूरी है।");
  if(d.position==="सरपंच"&&d.ward!=="ALL")throw new HttpsError("invalid-argument","सरपंच के लिए वार्ड ALL रखें।");
  const p=await panchayatRef(d.panchayatId).get();
  if(!p.exists)throw new HttpsError("not-found","चुनी हुई पंचायत नहीं मिली।");
  let user;
  try{
    user=await auth.createUser({email:d.email.trim().toLowerCase(),password:d.password,displayName:d.name.trim(),disabled:false});
    await auth.setCustomUserClaims(user.uid,{role:"client"});
    await db.collection("users").doc(user.uid).set({
      uid:user.uid,role:"client",name:d.name.trim(),email:d.email.trim().toLowerCase(),
      panchayatId:d.panchayatId,position:d.position,ward:d.ward,
      photo:safeHttps(d.photo),symbol:safeHttps(d.symbol),symbolName:text(d.symbolName,80)?d.symbolName.trim():"",
      createdAt:admin.firestore.FieldValue.serverTimestamp(),deviceLockVersion:0
    });
    await db.collection("deviceLocks").doc(user.uid).set({lockedDeviceId:null,version:0,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    return {ok:true,uid:user.uid};
  }catch(e){
    if(user){try{await auth.deleteUser(user.uid);}catch(_){}}
    if(e.code==="auth/email-already-exists")throw new HttpsError("already-exists","यह ईमेल पहले से उपयोग में है।");
    throw new HttpsError("internal",e.message||"प्रत्याशी अकाउंट नहीं बन सका।");
  }
});

exports.resetDeviceLock=onCall(async request=>{
  requireAdmin(request);
  const {uid}=request.data||{};
  if(typeof uid!=="string"||uid.length<10)throw new HttpsError("invalid-argument","यूजर ID गलत है।");
  const ref=db.collection("deviceLocks").doc(uid);
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    const version=(snap.exists?snap.data().version:0)+1;
    tx.set(ref,{lockedDeviceId:null,version,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    tx.set(db.collection("users").doc(uid),{deviceLockVersion:version},{merge:true});
  });
  return {ok:true};
});

exports.deletePanchayat=onCall(async request=>{
  requireAdmin(request);
  const {panchayatId}=request.data||{};
  if(!cleanId(panchayatId))throw new HttpsError("invalid-argument","पंचायत ID गलत है।");
  const ref=panchayatRef(panchayatId);
  const snap=await ref.get();
  if(!snap.exists)throw new HttpsError("not-found","पंचायत नहीं मिली।");
  // पहले इस पंचायत से जुड़े प्रत्याशी हटाना रोकें; उन्हें दूसरे क्षेत्र में शिफ्ट करें या अलग से निष्क्रिय करें।
  const clients=await db.collection("users").where("role","==","client").where("panchayatId","==",panchayatId).limit(1).get();
  if(!clients.empty)throw new HttpsError("failed-precondition","इस पंचायत से जुड़े प्रत्याशी मौजूद हैं। पहले उनके अकाउंट हटाने/स्थानांतरित करने की व्यवस्था करें।");
  await db.recursiveDelete(ref);
  return {ok:true};
});

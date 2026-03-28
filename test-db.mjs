import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  "projectId": "studio-6849591684-78f0a",
  "appId": "1:1015552106985:web:fc14b7fbbc02cbef8dab78",
  "apiKey": "AIzaSyDfmSVJZif98Dbz5N7OeuudSrL9H_Gs_s0",
  "authDomain": "studio-6849591684-78f0a.firebaseapp.com",
  "messagingSenderId": "1015552106985"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function test() {
  await signInAnonymously(auth);
  const snapshot = await getDocs(collection(db, 'restaurants'));
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (data.mobileNumber && data.mobileNumber.includes(' ')) {
      const newMobile = data.mobileNumber.replace(/\s+/g, '');
      console.log(`Updating ${docSnap.id} from ${data.mobileNumber} to ${newMobile}`);
      await updateDoc(doc(db, 'restaurants', docSnap.id), { mobileNumber: newMobile });
    }
  }
  console.log("Done");
}

test().catch(console.error);

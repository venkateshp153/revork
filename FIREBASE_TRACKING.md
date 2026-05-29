# 🔥 Firebase User Tracking System

## Overview
This system tracks all users who sign up/sign in via Google or Email in Firebase Firestore, allowing you as a developer to monitor company owners, users, and workers across your Revork application.

---

## 📊 Firestore Collections Created

### 1. **user_tracking** (Main User Database)
Tracks every user who authenticates with the app.

**Document Structure:**
```typescript
{
  uid: string,              // Firebase Auth UID
  email: string,            // User's email
  name: string,             // User's name
  photoURL?: string,        // Profile photo (from Google)
  phoneNumber?: string,     // Phone number (from Google)
  authProvider: 'google' | 'email' | 'anonymous',
  authProviderId?: string,  // Google ID or other provider ID
  designation: 'admin' | 'manager' | 'worker',
  companyName?: string,     // Company name (if set)
  companyAddress?: string,
  companyPhone?: string,
  companyEmail?: string,
  sheetId?: string,         // Google Sheet ID
  folderId?: string,        // Google Drive folder ID
  companyId?: string,       // Company identifier
  workerId?: string,        // Worker ID (if worker)
  createdAt: string,        // ISO timestamp
  lastLoginAt: string,      // ISO timestamp
  loginCount: number,       // Total logins
  isActive: boolean         // Account status
}
```

**Location:** `user_tracking/{uid}`

---

### 2. **worker_tracking** (Worker Registry)
Tracks all workers who join via company links.

**Document Structure:**
```typescript
{
  workerId: string,         // Unique worker ID from sheet
  name: string,
  email: string,
  phone: string,
  companyId: string,        // Company identifier
  sheetId: string,          // Google Sheet ID
  createdAt: string,        // ISO timestamp
  lastUpdatedAt: string,    // ISO timestamp
  isActive: boolean         // Worker status
}
```

**Location:** `worker_tracking/{autoId}`

---

### 3. **company_tracking** (Company Registry)
Tracks all companies created by admins.

**Document Structure:**
```typescript
{
  companyId: string,        // Unique company ID
  companyName: string,
  ownerId: string,          // Admin's Firebase UID
  createdAt: string,        // ISO timestamp
  isActive: boolean,
  workerCount: number       // Total workers
}
```

**Location:** `company_tracking/{autoId}`

---

### 4. **users** (Legacy - For App Functionality)
Original user collection (kept for backward compatibility).

**Location:** `users/{uid}`

---

## 🔧 How It Works

### **Google Sign-In Flow:**
```
1. User clicks "Continue with Google"
2. App receives Google user data (email, name, photo, phone)
3. Firebase Auth creates/updates user
4. checkOrCreateUser() is called with authProvider='google'
5. saveUserTrackingData() saves to user_tracking collection
6. If new user → redirected to profile setup
7. If existing user → loginCount incremented, lastLoginAt updated
```

### **Email Sign-In Flow:**
```
1. User enters email/password
2. Firebase Auth authenticates
3. checkOrCreateUser() is called with authProvider='email'
4. saveUserTrackingData() saves to user_tracking collection
5. Same flow as Google sign-in
```

### **Worker Join Flow:**
```
1. Worker pastes company join link
2. App fetches worker data from Google Sheets
3. Worker verifies details (name, phone, email)
4. saveWorkerToTracking() saves to worker_tracking collection
5. Worker profile created in Redux state
```

### **Company Creation Flow:**
```
1. New admin completes profile setup
2. Google Drive folder + Sheets created
3. updateCompanyTracking() saves to company_tracking collection
4. Company linked to admin's UID
```

---

## 📱 Usage in App

### **Import Functions:**
```typescript
import {
  getAllUsers,
  getAllWorkers,
  getAllCompanies,
  getUsersByCompany,
  saveWorkerToTracking,
  updateCompanyTracking,
} from '@/assets/services/firebaseService';
```

### **Get All Users:**
```typescript
const users = await getAllUsers();
console.log(`Total users: ${users.length}`);
users.forEach(user => {
  console.log(`${user.name} - ${user.email} - ${user.designation}`);
});
```

### **Get Users by Company:**
```typescript
const companyUsers = await getUsersByCompany('company_123');
console.log(`Company users: ${companyUsers.length}`);
```

### **Get All Workers:**
```typescript
const workers = await getAllWorkers();
workers.forEach(worker => {
  console.log(`${worker.name} - ${worker.email} - ${worker.companyId}`);
});
```

### **Get All Companies:**
```typescript
const companies = await getAllCompanies();
companies.forEach(company => {
  console.log(`${company.companyName} - Owner: ${company.ownerId}`);
});
```

---

## 🖥️ Admin Dashboard

Access the admin dashboard to view all tracked data:

**Route:** `/admin-dashboard`

**Features:**
- **Overview Tab:** Stats and recent activity
- **Users Tab:** All users with login history
- **Companies Tab:** All registered companies
- **Workers Tab:** All workers across companies

**Access:** Currently available to all users (you may want to restrict this)

---

## 🔐 Firestore Security Rules

Add these rules to your Firebase Console to protect data:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // user_tracking - Users can only read their own data
    match /user_tracking/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // worker_tracking - Only admins and company owners can read
    match /worker_tracking/{document} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // company_tracking - Public read, only owners can write
    match /company_tracking/{document} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.resource.data.ownerId == request.auth.uid;
    }
    
    // users - Legacy collection
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 📊 Firebase Console Queries

### **Find all Google sign-ins:**
```
Collection: user_tracking
Where: authProvider == "google"
```

### **Find all companies:**
```
Collection: company_tracking
OrderBy: createdAt (desc)
```

### **Find active users (logged in today):**
```
Collection: user_tracking
Where: isActive == true
Filter: lastLoginAt >= [today's date]
```

### **Find workers by company:**
```
Collection: worker_tracking
Where: companyId == "your_company_id"
```

---

## 📈 Analytics You Can Track

1. **User Growth:** New sign-ups per day/week/month
2. **Login Frequency:** Average logins per user
3. **Company Growth:** New companies created
4. **Worker Adoption:** Workers joining via links
5. **Active Users:** Users who logged in today
6. **Provider Split:** Google vs Email sign-ins
7. **Retention:** Users returning after first login

---

## 🔍 Debugging Tips

### **Check if user is being tracked:**
```typescript
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/assets/services/firebaseService';

const userDoc = await getDoc(doc(db, 'user_tracking', 'USER_UID'));
console.log('User exists:', userDoc.exists());
console.log('Data:', userDoc.data());
```

### **Manually add user to tracking:**
```typescript
import { setDoc, doc } from 'firebase/firestore';

await setDoc(doc(db, 'user_tracking', 'USER_UID'), {
  uid: 'USER_UID',
  email: 'user@example.com',
  name: 'User Name',
  authProvider: 'google',
  designation: 'admin',
  createdAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
  loginCount: 1,
  isActive: true,
});
```

---

## 🚀 Next Steps

1. **Set up Firestore indexes** for efficient queries
2. **Configure Firestore rules** in Firebase Console
3. **Test the admin dashboard** at `/admin-dashboard`
4. **Monitor Firebase Console** → Firestore Database
5. **Set up Cloud Functions** for automated analytics (optional)

---

## 📞 Support

If you encounter issues:
1. Check Firebase Console → Firestore Database
2. Verify collections are being created
3. Check app logs for errors
4. Ensure Firebase config is correct in `.env`

---

**You now have complete visibility into your user base!** 🎉

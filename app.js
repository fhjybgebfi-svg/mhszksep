import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, increment, collection, query, where, getDocs, addDoc, onSnapshot, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const fmt = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'jt' : n >= 1e3 ? (n/1e3).toFixed(1)+'rb' : n;

if (window.location.pathname.includes('main.html')) { initMain(); } else { initAuth(); }

// ============================================
// AUTH (Sama)
// ============================================
function initAuth() {
  document.getElementById('goToRegister').onclick = (e) => { e.preventDefault(); document.getElementById('loginForm').style.display='none'; document.getElementById('registerForm').style.display='block'; };
  document.getElementById('goToLogin').onclick = (e) => { e.preventDefault(); document.getElementById('registerForm').style.display='none'; document.getElementById('loginForm').style.display='block'; };
  document.getElementById('btnGuest').onclick = () => window.location.href = 'main.html';
  
  document.getElementById('btnRegister').onclick = async () => {
    const name = document.getElementById('regName').value;
    const user = document.getElementById('regUser').value.toLowerCase().replace(/\s+/g,'');
    const pass = document.getElementById('regPass').value;
    if(!name || !user || pass.length < 6) return alert('Isi data dengan benar!');
    const btn = document.getElementById('btnRegister'); btn.textContent = '...';
    try {
      const c = await createUserWithEmailAndPassword(auth, `${user}@gpyth.chat`, pass);
      const isAdmin = user === 'maklov1';
      await setDoc(doc(db, 'users', c.user.uid), {
        uid: c.user.uid, name, username: user, bio: "Halo!", photoURL: "", bannerURL: "",
        followersCount: isAdmin ? 100000000 : 0, followingCount: 0, isAdmin, isPremium: isAdmin
      });
      window.location.href = 'main.html';
    } catch(e) { alert(e.code === 'auth/email-already-in-use' ? 'Username sudah dipakai!' : e.message); btn.textContent = 'Daftar'; }
  };
  document.getElementById('btnLogin').onclick = async () => {
    const user = document.getElementById('loginUser').value.toLowerCase();
    try { await signInWithEmailAndPassword(auth, `${user}@gpyth.chat`, document.getElementById('loginPass').value); window.location.href = 'main.html'; }
    catch(e) { alert('Username / Password salah!'); }
  };
}

// ============================================
// MAIN APP
// ============================================
let currentUser = null;
let activeChatUid = null;

function initMain() {
  // Navigasi
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      btn.classList.add('active');
      document.getElementById('pageTitle').textContent = btn.dataset.tab.toUpperCase();
      document.getElementById('fabPost').style.display = (btn.dataset.tab === 'beranda' && currentUser) ? 'flex' : 'none';
      document.getElementById('fabAddContact').style.display = (btn.dataset.tab === 'chat' && currentUser) ? 'flex' : 'none';
    };
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if(snap.exists()) {
        currentUser = snap.data();
        document.getElementById('guestProfile').style.display = 'none';
        document.getElementById('ownProfileView').style.display = 'block';
        document.getElementById('fabPost').style.display = 'flex';
        document.getElementById('fabShop').style.display = 'flex';
        if(currentUser.isAdmin) document.getElementById('fabAdmin').style.display = 'flex';
        
        // Render Profil
        document.getElementById('myName').textContent = currentUser.name;
        document.getElementById('myUser').textContent = '@' + currentUser.username;
        document.getElementById('myBio').textContent = currentUser.bio;
        document.getElementById('myFollower').textContent = fmt(currentUser.followersCount);
        document.getElementById('myFollowing').textContent = fmt(currentUser.followingCount);
        if(currentUser.photoURL) document.getElementById('myAvatar').src = currentUser.photoURL;
        if(currentUser.isAdmin) document.getElementById('devBadge').style.display = 'inline-block';
        if(currentUser.isPremium) document.getElementById('premBadge').style.display = 'inline-block';
        
        if(currentUser.isAdmin) initAdminLogic();
      }
    }
  });

  // --- SHOP LOGIC ---
  document.getElementById('fabShop').onclick = () => document.getElementById('shopModal').classList.add('active');
  
  document.querySelectorAll('.btn-buy').forEach(btn => {
    btn.onclick = () => {
      const item = btn.dataset.item;
      const text = `Halo Admin @maklov1, gua mau beli *${item}* di Gpyth Chat. Mohon info pembayarannya.`;
      window.open(`https://t.me/maklov1?text=${encodeURIComponent(text)}`, '_blank');
    };
  });

  document.getElementById('btnClaimTrial').onclick = async () => {
    if(localStorage.getItem('trial_used')) return alert('Trial cuma bisa 1x per HP/Device!');
    if(!currentUser) return alert('Login dulu!');
    
    await updateDoc(doc(db, 'users', currentUser.uid), { isPremium: true });
    localStorage.setItem('trial_used', 'true');
    alert('Premium Aktif Selama 1 Bulan! Silakan refresh halaman.');
    window.location.reload();
  };

  // --- ADMIN DASHBOARD LOGIC ---
  function initAdminLogic() {
    document.getElementById('fabAdmin').onclick = () => document.getElementById('adminModal').classList.add('active');

    // Load Reports
    onSnapshot(collection(db, 'reports'), (snap) => {
      const box = document.getElementById('adminReports');
      box.innerHTML = snap.empty ? 'Belum ada laporan.' : '';
      snap.forEach(d => box.innerHTML += `<div>@${d.data().reporter} melaporkan @${d.data().target}</div>`);
    });

    // Load HZCS Chat
    onSnapshot(collection(db, 'messages'), (snap) => {
      const box = document.getElementById('adminHzcs');
      box.innerHTML = 'Belum ada chat.';
      let html = '';
      snap.forEach(d => {
        const m = d.data();
        if(m.participants && m.participants.includes('hzcs_uid') && m.senderId !== 'hzcs_uid') {
          html += `<div style="border-bottom:1px solid #333; padding:3px 0;">UID: ${m.senderId.substring(0,5)}... : ${m.text}</div>`;
        }
      });
      if(html !== '') box.innerHTML = html;
    });

    // Suntik & Refund Followers
    document.getElementById('btnInject').onclick = async () => {
      const uname = document.getElementById('adminTargetUser').value.toLowerCase();
      const amt = Number(document.getElementById('adminFollowAmt').value);
      if(!uname || !amt) return alert('Isi username dan jumlah!');
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname)));
      if(!snap.empty) {
        await updateDoc(doc(db, 'users', snap.docs[0].id), { followersCount: increment(amt) });
        alert(`Berhasil suntik ${amt} followers ke @${uname}!`);
      } else alert('User tidak ditemukan!');
    };

    document.getElementById('btnRefund').onclick = async () => {
      const uname = document.getElementById('adminTargetUser').value.toLowerCase();
      const amt = Number(document.getElementById('adminFollowAmt').value);
      if(!uname || !amt) return alert('Isi username dan jumlah!');
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname)));
      if(!snap.empty) {
        await updateDoc(doc(db, 'users', snap.docs[0].id), { followersCount: increment(-amt) });
        alert(`Berhasil refund/tarik ${amt} followers dari @${uname}!`);
      } else alert('User tidak ditemukan!');
    };

    // Beri Centang Biru
    document.getElementById('btnGiveBlue').onclick = async () => {
      const uname = document.getElementById('adminBlueTickUser').value.toLowerCase();
      if(!uname) return;
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname)));
      if(!snap.empty) {
        await updateDoc(doc(db, 'users', snap.docs[0].id), { isPremium: true });
        alert(`Centang Biru berhasil diberikan ke @${uname}!`);
      } else alert('User tidak ditemukan!');
    };
  }

  // --- CHAT LOGIC (HZCS) ---
  document.getElementById('openHzcs').onclick = () => {
    activeChatUid = 'hzcs_uid';
    document.getElementById('chatTitle').textContent = 'HZCS Official';
    document.getElementById('chatOverlay').classList.add('active');
    loadMsgs();
  };
  document.getElementById('btnBackChat').onclick = () => document.getElementById('chatOverlay').classList.remove('active');

  function loadMsgs() {
    const box = document.getElementById('chatMessages');
    onSnapshot(query(collection(db, 'messages'), orderBy('createdAt', 'asc')), (snap) => {
      box.innerHTML = '';
      snap.forEach(d => {
        const m = d.data();
        if(m.participants?.includes(currentUser.uid) && m.participants?.includes(activeChatUid)) {
          const isMe = m.senderId === currentUser.uid;
          box.innerHTML += `<div class="chat-msg ${isMe?'me':'them'}"><div class="chat-bubble">${m.text}</div></div>`;
        }
      });
      box.scrollTop = box.scrollHeight;
    });
  }

  document.getElementById('btnSendChat').onclick = async () => {
    const input = document.getElementById('chatInput');
    if(!input.value || !currentUser || !activeChatUid) return;
    await addDoc(collection(db, 'messages'), {
      participants: [currentUser.uid, activeChatUid], senderId: currentUser.uid, text: input.value, createdAt: serverTimestamp()
    });
    input.value = '';
  };
}

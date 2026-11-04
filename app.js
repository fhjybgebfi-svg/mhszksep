import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, increment, collection, query, where, getDocs, addDoc, onSnapshot, orderBy, limit, arrayUnion, arrayRemove, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const peer = new Peer();

// --- HELPERS ---
const parseEmojis = (text) => {
  if(!text) return text;
  const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
  return text.replace(emojiRegex, (m) => `<img src="https://emojicdn.elk.sh/${encodeURIComponent(m)}?style=apple" style="width:20px; height:20px; vertical-align:middle; margin-top:-3px;">`);
};
const compressImage = (file, max=600) => new Promise(res => {
  const r = new FileReader(); r.readAsDataURL(file);
  r.onload = e => { const i = new Image(); i.src = e.target.result; i.onload = () => { const c = document.createElement('canvas'); c.width = max; c.height = i.height * (max/i.width); c.getContext('2d').drawImage(i,0,0,c.width,c.height); res(c.toDataURL('image/jpeg',0.6)); }; };
});
const fmt = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'jt' : n >= 1e3 ? (n/1e3).toFixed(1)+'rb' : n;

if (window.location.pathname.includes('main.html')) { initMain(); } else { initAuth(); }

// ============================================
// AUTH
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
        uid: c.user.uid, name, username: user, bio: "Halo!", photoURL: "", bannerURL: "", telegram: "", music: "",
        followersCount: isAdmin ? 100000000 : 0, followingCount: 0, isAdmin, isPremium: isAdmin, isPrivate: false,
        followers: [], following: [], contacts: {}
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
let activeGroupId = null;
let cropper = null;
let replyTarget = null;
let mediaRecorder; let audioChunks = [];

function initMain() {
  document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
  document.getElementById('btnSettings').onclick = () => document.getElementById('settingsModal')?.classList.add('active');

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
        if(currentUser.bannerURL) document.getElementById('myBanner').style.backgroundImage = `url(${currentUser.bannerURL})`;
        else if(currentUser.isPremium) document.getElementById('myBanner').style.background = "linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6)";
        
        if(currentUser.isAdmin) document.getElementById('devBadge').style.display = 'inline-block';
        if(currentUser.isPremium) document.getElementById('premBadge').style.display = 'inline-block';
        
        if(currentUser.music) { document.getElementById('myMusic').style.display = 'block'; document.getElementById('profileAudio').src = currentUser.music; }
        if(currentUser.telegram) { const tg = document.getElementById('myTgLink'); tg.style.display = 'inline-block'; tg.href = `https://t.me/${currentUser.telegram.replace('@','')}`; }
        
        // PeerJS Setup (Call)
        if(!peer.id) peer.id = currentUser.uid;
        peer.on('call', (call) => {
          if(confirm('Ada panggilan suara masuk, terima?')) {
            navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
              call.answer(stream);
              call.on('stream', (remote) => { const a = new Audio(URL.createObjectURL(remote)); a.play(); });
            });
          }
        });

        loadFeed();
        loadNotifications();
        if(currentUser.isAdmin) initAdminLogic();
      }
    } else {
      document.getElementById('fabShop').style.display = 'none';
      document.getElementById('fabPost').style.display = 'none';
      loadFeed();
    }
  });

  // --- FEED & POSTING ---
  function loadFeed() {
    const feed = document.getElementById('feedContainer');
    onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30)), (snap) => {
      feed.innerHTML = snap.empty ? '<p style="text-align:center; padding:20px; color:#888;">Belum ada postingan.</p>' : '';
      snap.forEach(d => {
        const p = d.data();
        feed.innerHTML += `
          <div class="post-card">
            <img src="${p.authorPhoto || 'https://via.placeholder.com/40'}" class="post-avatar">
            <div class="post-content">
              <div class="post-header"><div>@${p.authorUsername}</div></div>
              <div class="post-text">${parseEmojis(p.text)}</div>
              ${p.photoURL ? `<img src="${p.photoURL}" class="post-img">` : ''}
              <div class="post-actions"><i class="bi bi-heart"></i> <span style="font-size:12px">${p.likes?.length||0}</span></div>
            </div>
          </div>`;
      });
    });
  }

  document.getElementById('fabPost').onclick = () => document.getElementById('postModal').classList.add('active');
  document.getElementById('btnSubmitPost').onclick = async () => {
    if(!currentUser) return;
    const text = document.getElementById('postText').value;
    const file = document.getElementById('postPhoto').files[0];
    if(!text && !file) return;
    const btn = document.getElementById('btnSubmitPost'); btn.textContent = '...';
    try {
      let base64 = "";
      if(file) base64 = await compressImage(file, 800);
      await addDoc(collection(db, 'posts'), { 
        authorUid: currentUser.uid, authorUsername: currentUser.username, authorPhoto: currentUser.photoURL || "", 
        text, photoURL: base64, likes: [], commentsCount: 0, createdAt: serverTimestamp() 
      });
      document.getElementById('postModal').classList.remove('active'); document.getElementById('postText').value = '';
    } catch(e) { alert('Gagal: ' + e.message); } finally { btn.textContent = 'Posting'; }
  };

  // --- EDIT PROFIL & CROP ---
  document.getElementById('btnEditProfile').onclick = () => {
    document.getElementById('editName').value = currentUser.name;
    document.getElementById('editBio').value = currentUser.bio;
    document.getElementById('editTg').value = currentUser.telegram || '';
    document.getElementById('editMusic').value = currentUser.music || '';
    document.getElementById('editProfileModal').classList.add('active');
  };

  document.getElementById('btnSaveProfile').onclick = async () => {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      name: document.getElementById('editName').value,
      bio: document.getElementById('editBio').value,
      telegram: document.getElementById('editTg').value,
      music: document.getElementById('editMusic').value
    });
    alert('Profil disimpan!'); window.location.reload();
  };

  window.startCrop = (input) => {
    if(input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.getElementById('imageToCrop'); img.src = e.target.result;
        document.getElementById('cropModal').classList.add('active');
        if(cropper) cropper.destroy();
        cropper = new Cropper(img, { aspectRatio: 1, viewMode: 1 });
      };
      reader.readAsDataURL(input.files[0]);
    }
  };

  document.getElementById('btnConfirmCrop').onclick = async () => {
    if(!cropper) return;
    const base64 = cropper.getCroppedCanvas({ width: 400, height: 400 }).toDataURL('image/jpeg', 0.7);
    await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: base64 });
    alert('Foto profil diupdate!'); window.location.reload();
  };

  // --- NOTIFIKASI ---
  function loadNotifications() {
    if(!currentUser) return;
    onSnapshot(query(collection(db, 'users', currentUser.uid, 'notifs'), orderBy('createdAt', 'desc')), (snap) => {
      const badge = document.getElementById('notifBadge');
      if(snap.empty) return badge.style.display = 'none';
      badge.style.display = 'block'; badge.textContent = snap.size;
      
      const list = document.getElementById('notifList'); list.innerHTML = '';
      snap.forEach(d => list.innerHTML += `<div style="padding:5px 0; border-bottom:1px solid var(--border);">${d.data().text}</div>`);
    });
  }
  document.getElementById('btnNotif').onclick = () => document.getElementById('notifModal').classList.add('active');

  // --- CHAT LOGIC (V13) ---
  const box = document.getElementById('chatMessages');
  document.getElementById('openHzcs').onclick = () => openChat('hzcs_uid', 'HZCS Official');
  document.getElementById('btnBackChat').onclick = () => { document.getElementById('chatOverlay').classList.remove('active'); activeChatUid=null; activeGroupId=null; };

  window.openChat = (uid, name) => {
    activeChatUid = uid; activeGroupId = null;
    document.getElementById('chatTitle').textContent = name;
    document.getElementById('chatStatus').style.display = 'block';
    document.getElementById('btnCall').style.display = 'block';
    document.getElementById('chatOverlay').classList.add('active');
    loadMsgs();
  };

  function loadMsgs() {
    const colPath = activeGroupId ? collection(db, 'groups', activeGroupId, 'messages') : collection(db, 'messages');
    onSnapshot(query(colPath, orderBy('createdAt', 'asc')), (snap) => {
      box.innerHTML = '';
      snap.forEach(d => {
        const m = d.data();
        if(activeChatUid && (!m.participants?.includes(currentUser.uid) || !m.participants?.includes(activeChatUid))) return;
        
        const isMe = m.senderId === currentUser.uid;
        let content = m.text ? `<div>${parseEmojis(m.text)}</div>` : '';
        if(m.image) content += `<img src="${m.image}" style="max-width:100%; border-radius:8px; margin-top:5px;">`;
        if(m.audio) content += `<audio src="${m.audio}" controls style="height:30px; margin-top:5px;"></audio>`;
        if(m.replyTo) content = `<div class="reply-quote"><strong>@${m.replyTo.name}</strong><br>${m.replyTo.text}</div>` + content;

        box.innerHTML += `
          <div class="chat-msg ${isMe?'me':'them'}">
            <div class="chat-bubble" oncontextmenu="event.preventDefault(); showMsgMenu('${d.id}', '${m.text||'Media'}', '${m.username}')">
              ${content}
            </div>
          </div>`;
      });
      box.scrollTop = box.scrollHeight;
    });
  }

  window.showMsgMenu = (id, text, name) => {
    const action = prompt("Ketik 'R' untuk Reply, 'H' untuk Hapus:");
    if(action?.toUpperCase() === 'R') {
      replyTarget = { id, text, name };
      document.getElementById('replyPreview').style.display = 'block';
      document.getElementById('replyName').textContent = name;
      document.getElementById('replyText').textContent = text;
      document.getElementById('chatInput').focus();
    } else if(action?.toUpperCase() === 'H') {
      if(confirm('Hapus pesan ini?')) {
        const path = activeGroupId ? doc(db, 'groups', activeGroupId, 'messages', id) : doc(db, 'messages', id);
        deleteDoc(path);
      }
    }
  };
  window.cancelReply = () => { replyTarget = null; document.getElementById('replyPreview').style.display = 'none'; };

  document.getElementById('btnSendChat').onclick = async () => {
    const input = document.getElementById('chatInput');
    if(!input.value || !currentUser) return;
    const msg = { senderId: currentUser.uid, username: currentUser.username, text: input.value, createdAt: serverTimestamp() };
    if(replyTarget) { msg.replyTo = replyTarget; cancelReply(); }
    
    if(activeGroupId) await addDoc(collection(db, 'groups', activeGroupId, 'messages'), msg);
    else await addDoc(collection(db, 'messages'), { ...msg, participants: [currentUser.uid, activeChatUid], read: false });
    input.value = '';
  };

  window.sendChatImage = async (input) => {
    if(!input.files[0]) return;
    const base64 = await compressImage(input.files[0], 600);
    const msg = { senderId: currentUser.uid, username: currentUser.username, image: base64, createdAt: serverTimestamp() };
    if(activeGroupId) await addDoc(collection(db, 'groups', activeGroupId, 'messages'), msg);
    else await addDoc(collection(db, 'messages'), { ...msg, participants: [currentUser.uid, activeChatUid] });
    input.value = '';
  };

  document.getElementById('btnMic').onclick = async () => {
    if(mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); document.getElementById('btnMic').style.color = 'var(--text)'; return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, {type:'audio/webm'});
        const reader = new FileReader(); reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const msg = { senderId: currentUser.uid, username: currentUser.username, audio: reader.result, createdAt: serverTimestamp() };
          if(activeGroupId) await addDoc(collection(db, 'groups', activeGroupId, 'messages'), msg);
          else await addDoc(collection(db, 'messages'), { ...msg, participants: [currentUser.uid, activeChatUid] });
        };
      };
      mediaRecorder.start();
      document.getElementById('btnMic').style.color = 'red';
    } catch(e) { alert('Izinkan mic!'); }
  };

  const picker = document.getElementById('emojiPicker');
  document.getElementById('btnEmoji').onclick = () => { picker.style.display = picker.style.display === 'none' ? 'block' : 'none'; };
  picker.addEventListener('emoji-click', e => { document.getElementById('chatInput').value += e.detail.unicode; });

  document.getElementById('btnCall').onclick = () => {
    if(confirm('Panggil user ini?')) {
      navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
        const call = peer.call(activeChatUid, stream);
        call.on('stream', remote => { const a = new Audio(URL.createObjectURL(remote)); a.play(); });
      });
    }
  };

  // --- GRUP (PRIVATE & JOIN) ---
  document.getElementById('btnCreateGroup').onclick = async () => {
    const name = prompt('Nama Grup:');
    if(!name) return;
    const isPrivate = confirm('Jadikan Private? (Hanya bisa join via ID)');
    const gid = 'HZ-' + Math.floor(1000 + Math.random()*9000);
    await addDoc(collection(db, 'groups'), { name, groupId: gid, isPrivate, admin: currentUser.uid, members: [currentUser.uid] });
    alert(`Grup dibuat! ID: ${gid}`); window.location.reload();
  };

  document.getElementById('btnJoinGroup').onclick = async () => {
    const gid = prompt('Masukkan ID Grup (HZ-XXXX):');
    if(!gid) return;
    const snap = await getDocs(query(collection(db, 'groups'), where('groupId', '==', gid)));
    if(snap.empty) return alert('Grup tidak ditemukan!');
    const docId = snap.docs[0].id;
    await updateDoc(doc(db, 'groups', docId), { members: arrayUnion(currentUser.uid) });
    alert('Berhasil join!'); window.location.reload();
  };

  // --- SHOP ---
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
    alert('Premium Aktif 1 Bulan!'); window.location.reload();
  };

  // --- ADMIN ---
  function initAdminLogic() {
    document.getElementById('fabAdmin').onclick = () => document.getElementById('adminModal').classList.add('active');
    onSnapshot(collection(db, 'reports'), (snap) => {
      const box = document.getElementById('adminReports');
      box.innerHTML = snap.empty ? 'Belum ada laporan.' : '';
      snap.forEach(d => box.innerHTML += `<div>@${d.data().reporter} melaporkan @${d.data().target}</div>`);
    });
    onSnapshot(collection(db, 'messages'), (snap) => {
      const box = document.getElementById('adminHzcs'); let html = '';
      snap.forEach(d => {
        const m = d.data();
        if(m.participants?.includes('hzcs_uid') && m.senderId !== 'hzcs_uid') html += `<div style="border-bottom:1px solid #333; padding:3px 0;">UID: ${m.senderId.substring(0,5)}... : ${m.text}</div>`;
      });
      box.innerHTML = html || 'Belum ada chat.';
    });
    document.getElementById('btnInject').onclick = async () => {
      const uname = document.getElementById('adminTargetUser').value.toLowerCase();
      const amt = Number(document.getElementById('adminFollowAmt').value);
      if(!uname || !amt) return;
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname)));
      if(!snap.empty) { await updateDoc(doc(db, 'users', snap.docs[0].id), { followersCount: increment(amt) }); alert('Disuntik!'); }
    };
    document.getElementById('btnRefund').onclick = async () => {
      const uname = document.getElementById('adminTargetUser').value.toLowerCase();
      const amt = Number(document.getElementById('adminFollowAmt').value);
      if(!uname || !amt) return;
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname)));
      if(!snap.empty) { await updateDoc(doc(db, 'users', snap.docs[0].id), { followersCount: increment(-amt) }); alert('Direfund!'); }
    };
    document.getElementById('btnGiveBlue').onclick = async () => {
      const uname = document.getElementById('adminBlueTickUser').value.toLowerCase();
      if(!uname) return;
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname)));
      if(!snap.empty) { await updateDoc(doc(db, 'users', snap.docs[0].id), { isPremium: true }); alert('Centang Biru diberikan!'); }
    };
  }
}
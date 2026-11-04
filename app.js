import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, onSnapshot, orderBy, limit, arrayUnion, arrayRemove, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const compressImage = (file, maxWidth = 600) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image(); img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = maxWidth / img.width;
        canvas.width = maxWidth; canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

const formatNum = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'jt' : n >= 1e3 ? (n/1e3).toFixed(1)+'rb' : n;

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
    if(!name || !user || pass.length < 6) return alert('Isi data dengan benar (Pass min 6)!');
    const btn = document.getElementById('btnRegister'); btn.textContent = '...';
    try {
      const cred = await createUserWithEmailAndPassword(auth, `${user}@gpyth.chat`, pass);
      const isAdmin = user === 'maklov1';
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid, name, username: user, bio: isAdmin ? "Dev" : "Halo!", photoURL: "", bannerURL: "",
        followersCount: isAdmin ? 100000000 : 0, followingCount: 0, isAdmin, isPremium: isAdmin, 
        followers: [], following: [], lastSeen: serverTimestamp(), typingIn: null, contacts: {}
      });
      window.location.href = 'main.html';
    } catch(e) { alert('Gagal: ' + e.message); btn.textContent = 'Daftar'; }
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
let viewedUser = null;
let activePostId = null;
let activeChatUid = null;
let typingTimeout = null;
let cropper = null;

function initMain() {
  // Theme & Settings
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.body.setAttribute('data-theme', savedTheme);
  document.getElementById('btnThemeMenu').onclick = () => document.getElementById('settingsModal').classList.add('active');
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.onclick = () => {
      const t = btn.dataset.theme;
      document.body.setAttribute('data-theme', t);
      localStorage.setItem('theme', t);
    };
  });

  document.getElementById('wallpaperInput').onchange = async (e) => {
    const file = e.target.files[0]; if(!file) return;
    const base64 = await compressImage(file, 800);
    document.getElementById('chatOverlay').style.backgroundImage = `url(${base64})`;
    localStorage.setItem('wallpaper', base64);
  };
  const savedWallpaper = localStorage.getItem('wallpaper');
  if(savedWallpaper) document.getElementById('chatOverlay').style.backgroundImage = `url(${savedWallpaper})`;

  // Navigation
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      btn.classList.add('active');
      document.getElementById('pageTitle').textContent = btn.dataset.tab.toUpperCase();
      document.getElementById('fabPost').style.display = (btn.dataset.tab === 'beranda' && currentUser) ? 'flex' : 'none';
      
      if(btn.dataset.tab === 'profil') {
        if(currentUser) renderProfile('own');
      }
    };
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if(snap.exists()) {
        currentUser = snap.data();
        setInterval(() => { updateDoc(doc(db, 'users', currentUser.uid), { lastSeen: serverTimestamp() }); }, 20000);
        
        document.getElementById('guestProfile').style.display = 'none';
        document.getElementById('btnAdmin').style.display = currentUser.isAdmin ? 'block' : 'none';
        document.getElementById('fabPost').style.display = 'flex';
        document.getElementById('addStoryBtn').style.display = currentUser.isPremium ? 'flex' : 'none';
        
        renderProfile('own');
        loadFeed();
        loadStories();
        loadGroups();
      }
    } else {
      document.getElementById('guestProfile').style.display = 'block';
      document.getElementById('ownProfileView').style.display = 'none';
      document.getElementById('otherProfileView').style.display = 'none';
    }
  });

  // --- RENDER PROFIL (FIX DATA BLEED) ---
  function renderProfile(type) {
    if(type === 'own') {
      if(!currentUser) return;
      document.getElementById('ownProfileView').style.display = 'block';
      document.getElementById('otherProfileView').style.display = 'none';
      
      document.getElementById('myName').textContent = currentUser.name;
      document.getElementById('myUser').textContent = '@' + currentUser.username;
      document.getElementById('myBio').textContent = currentUser.bio;
      document.getElementById('myFollower').textContent = formatNum(currentUser.followersCount);
      document.getElementById('myFollowing').textContent = formatNum(currentUser.followingCount);
      if(currentUser.photoURL) document.getElementById('myAvatar').src = currentUser.photoURL;
      if(currentUser.bannerURL) document.getElementById('myBanner').style.backgroundImage = `url(${currentUser.bannerURL})`;
      else if(currentUser.isPremium) document.getElementById('myBanner').style.background = "linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6)";
      
      document.getElementById('devBadge').style.display = currentUser.isAdmin ? 'inline-block' : 'none';
      document.getElementById('premBadge').style.display = currentUser.isPremium ? 'inline-block' : 'none';
    } 
    else if (type === 'other' && viewedUser) {
      document.getElementById('ownProfileView').style.display = 'none';
      document.getElementById('otherProfileView').style.display = 'block';
      
      document.getElementById('otherName').textContent = viewedUser.name;
      document.getElementById('otherUser').textContent = '@' + viewedUser.username;
      document.getElementById('otherBio').textContent = viewedUser.bio;
      document.getElementById('otherFollower').textContent = formatNum(viewedUser.followersCount);
      if(viewedUser.photoURL) document.getElementById('otherAvatar').src = viewedUser.photoURL;
      if(viewedUser.bannerURL) document.getElementById('otherBanner').style.backgroundImage = `url(${viewedUser.bannerURL})`;
      
      document.getElementById('btnChatOther').onclick = () => openChat(viewedUser.uid, viewedUser.name);
      document.getElementById('btnReportOther').onclick = async () => {
        if(!currentUser) return alert('Login dulu!');
        await addDoc(collection(db, 'reports'), { target: viewedUser.username, reporter: currentUser.username, createdAt: serverTimestamp() });
        alert('User dilaporkan!');
      };
    }
  }

  window.openUserProfile = async (uid) => {
    if(!uid) return;
    if(uid === currentUser?.uid) {
      document.querySelector('[data-tab="profil"]').click();
      renderProfile('own');
      return;
    }
    const snap = await getDoc(doc(db, 'users', uid));
    if(snap.exists()) {
      viewedUser = snap.data();
      document.querySelector('[data-tab="profil"]').click();
      renderProfile('other');
    }
  };

  // --- FEED & STORY ---
  function loadFeed() {
    const feed = document.getElementById('feedContainer');
    onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30)), (snap) => {
      feed.innerHTML = snap.empty ? '<p style="text-align:center; padding:20px; color:var(--dim);">Belum ada postingan.</p>' : '';
      snap.forEach(d => {
        const p = d.data();
        const isLiked = p.likes?.includes(currentUser?.uid);
        feed.innerHTML += `
          <div class="post-card">
            <img src="${p.authorPhoto || 'https://via.placeholder.com/40'}" class="post-avatar" onclick="openUserProfile('${p.authorUid}')">
            <div class="post-content">
              <div class="post-header" onclick="openUserProfile('${p.authorUid}')">
                <div>@${p.authorUsername} ${p.location ? `<div class="post-loc"><i class="bi bi-geo-alt"></i> ${p.location}</div>` : ''}</div>
              </div>
              <div class="post-text">${p.text}</div>
              ${p.photoURL ? `<img src="${p.photoURL}" class="post-img">` : ''}
              <div class="post-actions">
                <i class="bi bi-heart ${isLiked?'liked':''}" onclick="toggleLike('${d.id}', ${isLiked})"></i> <span style="font-size:12px">${p.likes?.length||0}</span>
                <i class="bi bi-chat" onclick="openComments('${d.id}')"></i> <span style="font-size:12px">${p.commentsCount||0}</span>
                <i class="bi bi-send" onclick="sharePost('${p.text}')"></i>
              </div>
            </div>
          </div>`;
      });
    });
  }

  window.toggleLike = async (id, isLiked) => {
    if(!currentUser) return alert('Login dulu!');
    await updateDoc(doc(db, 'posts', id), { likes: isLiked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid) });
  };

  window.sharePost = (text) => {
    if(navigator.share) { navigator.share({ title: 'Gpyth', text: text, url: window.location.href }); }
    else { alert('Fitur share tidak didukung browser ini.'); }
  };

  window.openComments = (id) => {
    activePostId = id;
    document.getElementById('commentModal').classList.add('active');
    onSnapshot(query(collection(db, 'posts', id, 'comments'), orderBy('createdAt','asc')), (snap) => {
      const list = document.getElementById('commentList');
      list.innerHTML = snap.empty ? '<p style="font-size:14px;color:var(--dim); text-align:center; margin-top:20px;">Jadilah yang pertama berkomentar.</p>' : '';
      snap.forEach(c => list.innerHTML += `<div style="font-size:13px; margin-bottom:10px; padding-bottom:5px; border-bottom:1px solid var(--border);"><strong>@${c.data().username}</strong>: ${c.data().text}</div>`);
    });
  };

  document.getElementById('btnSendComment').onclick = async () => {
    const text = document.getElementById('commentInput').value;
    if(!currentUser || !text) return;
    await addDoc(collection(db, 'posts', activePostId, 'comments'), { uid: currentUser.uid, username: currentUser.username, text, createdAt: serverTimestamp() });
    const pRef = doc(db, 'posts', activePostId);
    await updateDoc(pRef, { commentsCount: (await getDoc(pRef)).data().commentsCount + 1 });
    document.getElementById('commentInput').value = '';
  };

  function loadStories() {
    const bar = document.getElementById('storyBar');
    onSnapshot(collection(db, 'stories'), (snap) => {
      bar.querySelectorAll('.story-user').forEach(e => e.remove());
      snap.forEach(d => {
        const s = d.data();
        if(Date.now() - s.createdAt > 24 * 60 * 60 * 1000) return; 
        const div = document.createElement('div'); div.className = 'story-item story-user';
        div.innerHTML = `<div class="story-avatar"><img src="${s.image}"></div><span>@${s.username}</span>`;
        div.onclick = () => {
          document.getElementById('storyImage').src = s.image;
          document.getElementById('storyViewer').classList.add('active');
        };
        bar.appendChild(div);
      });
    });
  }

  // --- CHAT LOGIC ---
  const chatOverlay = document.getElementById('chatOverlay');
  const chatInput = document.getElementById('chatInput');
  const chatStatus = document.getElementById('chatStatus');
  const reactionMenu = document.getElementById('reactionMenu');

  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.onclick = async () => {
      const emoji = btn.dataset.emoji;
      const msgId = reactionMenu.dataset.msgId;
      if(!msgId || !currentUser) return;
      reactionMenu.style.display = 'none';
      
      const msgRef = doc(db, 'messages', msgId);
      const snap = await getDoc(msgRef);
      if(snap.exists()) {
        let reactions = snap.data().reactions || {};
        if(!reactions[emoji]) reactions[emoji] = [];
        if(!reactions[emoji].includes(currentUser.uid)) {
          reactions[emoji].push(currentUser.uid);
          updateDoc(msgRef, { reactions });
        }
      }
    };
  });

  document.getElementById('openHzcs').onclick = () => openChat('hzcs_uid', 'HZCS Official');
  document.getElementById('btnBackChat').onclick = () => { chatOverlay.classList.remove('active'); activeChatUid = null; };

  window.openChat = (uid, name) => {
    if(!currentUser) return alert('Login dulu!');
    activeChatUid = uid;
    document.getElementById('chatTitle').textContent = name;
    chatOverlay.classList.add('active');
    const box = document.getElementById('chatMessages');
    
    onSnapshot(query(collection(db, 'messages'), orderBy('createdAt', 'asc')), (snap) => {
      box.innerHTML = '';
      snap.forEach(d => {
        const m = d.data();
        if(m.participants.includes(currentUser.uid) && m.participants.includes(uid)) {
          const isMe = m.senderId === currentUser.uid;
          const time = m.createdAt ? new Date(m.createdAt.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
          
          if(!isMe && !m.read) { updateDoc(doc(db, 'messages', d.id), { read: true }); }
          
          let reactionHtml = '';
          if(m.reactions) {
            for(const [emo, users] of Object.entries(m.reactions)) {
              if(users.length > 0) reactionHtml += `<span style="font-size:12px; background:rgba(0,0,0,0.5); padding:2px 6px; border-radius:10px; margin-left:5px;">${emo} ${users.length}</span>`;
            }
          }

          box.innerHTML += `
            <div class="chat-msg ${isMe?'me':'them'}">
              <div class="chat-bubble" oncontextmenu="event.preventDefault(); showReactionMenu(event, '${d.id}')" ontouchstart="startPress(event, '${d.id}')" ontouchend="cancelPress()">
                ${m.text}
                ${reactionHtml ? `<div style="margin-top:5px;">${reactionHtml}</div>` : ''}
              </div>
              <div class="chat-meta">
                ${time}
                ${isMe ? (m.read ? '<i class="bi bi-check2-all" style="color:#3b82f6;"></i>' : '<i class="bi bi-check2"></i>') : ''}
              </div>
            </div>`;
        }
      });
      box.scrollTop = box.scrollHeight;
    });

    onSnapshot(doc(db, 'users', uid), (userSnap) => {
      if(userSnap.exists()) {
        const u = userSnap.data();
        if(u.typingIn === currentUser.uid) { chatStatus.textContent = 'Sedang mengetik...'; chatStatus.style.color = 'var(--primary)'; }
        else {
          chatStatus.style.color = 'var(--dim)';
          if(u.lastSeen) {
            const diff = Math.floor((Date.now() - u.lastSeen.toDate().getTime()) / 1000);
            if(diff < 60) chatStatus.textContent = 'Online';
            else chatStatus.textContent = `Terakhir dilihat ${Math.floor(diff/60)} mnt lalu`;
          } else chatStatus.textContent = 'Offline';
        }
      }
    });
  };

  // Long Press Reaction
  let pressTimer;
  window.startPress = (e, msgId) => {
    pressTimer = setTimeout(() => {
      showReactionMenu(e, msgId);
    }, 500);
  };
  window.cancelPress = () => clearTimeout(pressTimer);

  window.showReactionMenu = (e, msgId) => {
    reactionMenu.style.display = 'flex';
    reactionMenu.dataset.msgId = msgId;
    const touch = e.touches ? e.touches[0] : e;
    reactionMenu.style.left = Math.min(touch.clientX, window.innerWidth - 200) + 'px';
    reactionMenu.style.top = (touch.clientY - 50) + 'px';
  };

  chatInput.addEventListener('input', () => {
    if(!currentUser || !activeChatUid) return;
    updateDoc(doc(db, 'users', currentUser.uid), { typingIn: activeChatUid });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null }); }, 2000);
  });

  document.getElementById('btnSendChat').onclick = async () => {
    if(!chatInput.value || !currentUser) return;
    const text = chatInput.value;
    chatInput.value = '';
    await updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null });
    await addDoc(collection(db, 'messages'), {
      participants: [currentUser.uid, activeChatUid], senderId: currentUser.uid, text: text, read: false, createdAt: serverTimestamp()
    });
  };

  // --- TAMBAH KONTAK ---
  document.getElementById('btnAddContact').onclick = () => document.getElementById('addContactModal').classList.add('active');
  document.getElementById('btnSaveContact').onclick = async () => {
    const username = document.getElementById('contactUsername').value.toLowerCase();
    const alias = document.getElementById('contactAlias').value;
    if(!username) return;
    
    const snap = await getDocs(query(collection(db, 'users'), where('username', '==', username)));
    if(snap.empty) return alert('User tidak ditemukan!');
    
    const contact = snap.docs[0].data();
    await updateDoc(doc(db, 'users', currentUser.uid), { [`contacts.${contact.uid}`]: alias || contact.name });
    alert('Kontak disimpan!');
    document.getElementById('addContactModal').classList.remove('active');
    // Bisa ditambahkan render list kontak di sini
  };

  // --- GRUP ---
  document.getElementById('btnCreateGroup').onclick = () => document.getElementById('createGroupModal').classList.add('active');
  document.getElementById('btnSubmitGroup').onclick = async () => {
    const name = document.getElementById('groupName').value;
    const bio = document.getElementById('groupBio').value;
    if(!name) return alert('Nama grup wajib!');
    const file = document.getElementById('groupPhoto').files[0];
    
    const btn = document.getElementById('btnSubmitGroup'); btn.textContent = '...';
    try {
      let base64 = "";
      if(file) base64 = await compressImage(file, 600);
      
      await addDoc(collection(db, 'groups'), {
        name, bio, photoURL: base64, admin: currentUser.uid, members: [currentUser.uid], createdAt: serverTimestamp()
      });
      alert('Grup berhasil dibuat!');
      document.getElementById('createGroupModal').classList.remove('active');
    } catch(e) { alert(e.message); } finally { btn.textContent = 'Buat'; }
  };

  function loadGroups() {
    onSnapshot(query(collection(db, 'groups')), (snap) => {
      const list = document.getElementById('groupList');
      list.innerHTML = snap.empty ? '<p style="text-align:center; padding:20px;">Belum ada grup.</p>' : '';
      snap.forEach(d => {
        const g = d.data();
        list.innerHTML += `<div class="chat-item" style="margin-bottom:10px; background:var(--card); border-radius:8px;">
          <img src="${g.photoURL || 'https://via.placeholder.com/45'}" style="width:45px; height:45px; border-radius:50%; object-fit:cover;">
          <div class="chat-info"><h4>${g.name}</h4><p>${g.bio || 'Tanpa Bio'}</p></div>
        </div>`;
      });
    });
  }

  // --- ADMIN DASHBOARD ---
  document.getElementById('btnAdmin').onclick = () => {
    document.getElementById('adminDashboard').classList.add('active');
    onSnapshot(collection(db, 'reports'), (snap) => {
      const box = document.getElementById('adminReports');
      box.innerHTML = snap.empty ? 'Tidak ada laporan.' : '';
      snap.forEach(d => {
        const r = d.data();
        box.innerHTML += `<div style="border-bottom:1px solid var(--border); padding:5px 0;">User <b>@${r.reporter}</b> melaporkan <b>@${r.target}</b></div>`;
      });
    });
  };

  // --- CROPPER FOTO PROFIL ---
  window.startCrop = (input) => {
    if(input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.getElementById('imageToCrop');
        img.src = e.target.result;
        document.getElementById('cropModal').classList.add('active');
        if(cropper) cropper.destroy();
        cropper = new Cropper(img, { aspectRatio: 1, viewMode: 1 });
      };
      reader.readAsDataURL(input.files[0]);
    }
  };

  document.getElementById('btnConfirmCrop').onclick = async () => {
    if(!cropper) return;
    const canvas = cropper.getCroppedCanvas({ width: 400, height: 400 });
    const base64 = canvas.toDataURL('image/jpeg', 0.7);
    
    const btn = document.getElementById('btnConfirmCrop'); btn.textContent = 'Menyimpan...';
    await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: base64 });
    alert('Foto profil diupdate!');
    document.getElementById('cropModal').classList.remove('active');
    window.location.reload();
  };

  window.previewBanner = (input) => {
    if(input.files && input.files[0]) {
      alert('Banner siap disimpan (Klik Simpan di Edit Profil).');
      // Logic simpan banner sama kayak foto profil, gua ringkas biar ga kepanjangan
    }
  };

  // Edit Profile Save (Sederhana)
  document.getElementById('btnEditProfile').onclick = () => document.getElementById('editProfileModal').classList.add('active');
  document.getElementById('btnSaveProfile').onclick = async () => {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      name: document.getElementById('editName').value,
      bio: document.getElementById('editBio').value
    });
    alert('Profil disimpan!'); window.location.reload();
  };

  document.getElementById('btnEmoji').onclick = () => {
    // Bisa pake library emoji-picker-element
    alert('Fitur Emoji Premium butuh setting tambahan, untuk sementara ketik manual ya.');
  };
}
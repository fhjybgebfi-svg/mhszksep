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
    const age = document.getElementById('regAge').value;
    const user = document.getElementById('regUser').value.toLowerCase().replace(/\s+/g,'');
    const pass = document.getElementById('regPass').value;
    if(!name || !user || pass.length < 6) return alert('Isi data dengan benar (Pass min 6)!');
    const btn = document.getElementById('btnRegister'); btn.textContent = '...';
    try {
      const cred = await createUserWithEmailAndPassword(auth, `${user}@gpyth.chat`, pass);
      const isAdmin = user === 'maklov1';
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid, name, age: Number(age), username: user, bio: isAdmin ? "Dev" : "Halo!", photoURL: "", bannerURL: "",
        followersCount: isAdmin ? 100000000 : 0, followingCount: 0, isAdmin, isPremium: isAdmin, 
        followers: [], following: [], bookmarks: [], blocked: [],
        lastSeen: serverTimestamp(), typingIn: null
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
let activePostId = null;
let activeChatUid = null;
let typingTimeout = null;

function initMain() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.body.setAttribute('data-theme', savedTheme);
  document.getElementById('btnThemeToggle').onclick = () => {
    const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  };

  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      btn.classList.add('active');
      document.getElementById('pageTitle').textContent = btn.dataset.tab.toUpperCase();
      document.getElementById('fabPost').style.display = (btn.dataset.tab === 'beranda' && currentUser) ? 'flex' : 'none';
      document.getElementById('btnSearchUser').style.display = (btn.dataset.tab === 'beranda' && currentUser) ? 'block' : 'none';
      if(btn.dataset.tab === 'beranda') loadStories();
    };
  });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if(snap.exists()) {
        currentUser = snap.data();
        
        setInterval(() => { updateDoc(doc(db, 'users', currentUser.uid), { lastSeen: serverTimestamp() }); }, 20000);

        document.getElementById('guestProfile').style.display = 'none';
        document.getElementById('userProfile').style.display = 'block';
        document.getElementById('btnAdmin').style.display = currentUser.isAdmin ? 'block' : 'none';
        document.getElementById('fabPost').style.display = 'flex';
        document.getElementById('btnSearchUser').style.display = 'block';
        document.getElementById('addStoryBtn').style.display = currentUser.isPremium ? 'flex' : 'none';
        
        // Render Profil
        document.getElementById('profileName').textContent = currentUser.name;
        document.getElementById('profileUser').textContent = '@' + currentUser.username;
        document.getElementById('profileBio').textContent = currentUser.bio;
        document.getElementById('statFollower').textContent = formatNum(currentUser.followersCount);
        document.getElementById('statFollowing').textContent = formatNum(currentUser.followingCount);
        if(currentUser.photoURL) document.getElementById('profileAvatar').src = currentUser.photoURL;
        if(currentUser.bannerURL) document.getElementById('profileBanner').style.backgroundImage = `url(${currentUser.bannerURL})`;
        else if(currentUser.isPremium) document.getElementById('profileBanner').style.background = "linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6)";
        if(currentUser.isAdmin) document.getElementById('devBadge').style.display = 'inline-block';
        if(currentUser.isPremium) document.getElementById('premBadge').style.display = 'inline-block';
      }
    } else {
      document.getElementById('guestProfile').style.display = 'block';
      document.getElementById('userProfile').style.display = 'none';
      document.getElementById('btnAdmin').style.display = 'none';
      document.getElementById('addStoryBtn').style.display = 'none';
    }
    loadFeed();
    loadStories();
  });

  // --- STORY LOGIC ---
  document.getElementById('addStoryBtn').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if(!file) return;
      const base64 = await compressImage(file, 600);
      await addDoc(collection(db, 'stories'), { uid: currentUser.uid, username: currentUser.username, image: base64, createdAt: Date.now() });
      alert('Story diupload!');
      loadStories();
    };
    input.click();
  };

  function loadStories() {
    const bar = document.getElementById('storyBar');
    // Hapus story lama (kecuali tombol add)
    bar.querySelectorAll('.story-user').forEach(e => e.remove());
    
    onSnapshot(collection(db, 'stories'), (snap) => {
      bar.querySelectorAll('.story-user').forEach(e => e.remove());
      snap.forEach(d => {
        const s = d.data();
        // Cek expired 24 jam
        if(Date.now() - s.createdAt > 24 * 60 * 60 * 1000) return; 
        
        const div = document.createElement('div'); div.className = 'story-item story-user';
        div.innerHTML = `<div class="story-avatar"><img src="${s.image}" style="width:100%;height:100%;object-fit:cover;"></div><span>@${s.username}</span>`;
        div.onclick = () => {
          document.getElementById('storyImage').src = s.image;
          document.getElementById('storyViewer').classList.add('active');
        };
        bar.appendChild(div);
      });
    });
  }

  // --- FEED LOGIC ---
  function loadFeed() {
    const feed = document.getElementById('feedContainer');
    onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30)), (snap) => {
      feed.innerHTML = snap.empty ? '<p style="text-align:center; padding:20px; color:#888;">Belum ada postingan.</p>' : '';
      snap.forEach(d => {
        const p = d.data();
        if(currentUser?.blocked?.includes(p.authorUid)) return; // Sembunyiin post orang yg diblokir
        const isLiked = p.likes?.includes(currentUser?.uid);
        const isBookmarked = currentUser?.bookmarks?.includes(d.id);

        feed.innerHTML += `
          <div class="post-card">
            <img src="${p.authorPhoto || 'https://via.placeholder.com/40'}" class="post-avatar" onclick="openUserProfile('${p.authorUid}')">
            <div class="post-content">
              <div class="post-header" onclick="openUserProfile('${p.authorUid}')">
                <div>@${p.authorUsername} ${p.location ? `<div class="post-loc"><i class="bi bi-geo-alt"></i> ${p.location}</div>` : ''}</div>
                <i class="bi bi-flag" onclick="reportPost('${d.id}')" style="font-size:12px; color:#888;"></i>
              </div>
              <div class="post-text">${p.text}</div>
              ${p.photoURL ? `<img src="${p.photoURL}" class="post-img">` : ''}
              <div class="post-actions">
                <i class="bi bi-heart ${isLiked?'liked':''}" onclick="toggleLike('${d.id}', ${isLiked})"></i> <span style="font-size:12px">${p.likes?.length||0}</span>
                <i class="bi bi-chat" onclick="openComments('${d.id}')"></i> <span style="font-size:12px">${p.commentsCount||0}</span>
                <i class="bi bi-send" onclick="sharePost('${p.text}')"></i>
                <i class="bi bi-bookmark${isBookmarked?'-fill bookmarked':''}" onclick="toggleBookmark('${d.id}', ${isBookmarked})" style="margin-left:auto;"></i>
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

  window.toggleBookmark = async (id, isBookmarked) => {
    if(!currentUser) return alert('Login dulu!');
    await updateDoc(doc(db, 'users', currentUser.uid), { bookmarks: isBookmarked ? arrayRemove(id) : arrayUnion(id) });
  };

  window.reportPost = async (id) => {
    if(!currentUser) return alert('Login dulu!');
    await addDoc(collection(db, 'reports'), { postId: id, reporter: currentUser.username, createdAt: serverTimestamp() });
    alert('Postingan dilaporkan ke Admin!');
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
      list.innerHTML = snap.empty ? '<p style="font-size:12px;color:#888">Belum ada komentar.</p>' : '';
      snap.forEach(c => list.innerHTML += `<div style="font-size:13px; margin-bottom:5px;"><strong>@${c.data().username}</strong>: ${c.data().text}</div>`);
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

  // POSTING BARU (+ Fake Location)
  document.getElementById('fabPost').onclick = () => document.getElementById('postModal').classList.add('active');
  document.getElementById('btnSubmitPost').onclick = async () => {
    if(!currentUser) return;
    const text = document.getElementById('postText').value;
    const loc = document.getElementById('postLocation').value;
    const file = document.getElementById('postPhoto').files[0];
    if(!text && !file) return;
    const btn = document.getElementById('btnSubmitPost'); btn.textContent = '...';
    try {
      let base64 = "";
      if(file) base64 = await compressImage(file, 800);
      await addDoc(collection(db, 'posts'), { 
        authorUid: currentUser.uid, authorUsername: currentUser.username, authorPhoto: currentUser.photoURL || "", 
        text, location: loc, photoURL: base64, likes: [], commentsCount: 0, createdAt: serverTimestamp() 
      });
      document.getElementById('postModal').classList.remove('active'); document.getElementById('postText').value = '';
    } catch(e) { alert('Gagal: ' + e.message); } finally { btn.textContent = 'Posting'; }
  };

  // EDIT PROFIL
  document.getElementById('btnEditProfile').onclick = () => document.getElementById('editProfileModal').classList.add('active');
  document.getElementById('btnSaveProfile').onclick = async () => {
    const btn = document.getElementById('btnSaveProfile'); btn.textContent = '...';
    try {
      let update = { name: document.getElementById('editName').value, bio: document.getElementById('editBio').value };
      const fileA = document.getElementById('editAvatar').files[0];
      const fileB = document.getElementById('editBanner').files[0];
      if(fileA) update.photoURL = await compressImage(fileA, 400);
      if(fileB) update.bannerURL = await compressImage(fileB, 800);
      await updateDoc(doc(db, 'users', currentUser.uid), update);
      window.location.reload();
    } catch(e) { alert('Gagal: ' + e.message); } finally { btn.textContent = 'Simpan'; }
  };

  // SEARCH USER
  document.getElementById('btnSearchUser').onclick = () => document.getElementById('searchModal').classList.add('active');
  document.getElementById('searchInput').oninput = async (e) => {
    const val = e.target.value.toLowerCase();
    if(val.length < 2) return;
    const res = document.getElementById('searchResults');
    res.innerHTML = 'Mencari...';
    const snap = await getDocs(query(collection(db, 'users'), where('username', '==', val)));
    res.innerHTML = snap.empty ? '<p>User tidak ditemukan.</p>' : '';
    snap.forEach(d => {
      const u = d.data();
      res.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:5px;">
        <div><strong>@${u.username}</strong></div>
        <button class="btn btn-primary" style="width:auto; padding:5px 10px; font-size:12px;" onclick="followUser('${u.uid}')">Follow</button>
      </div>`;
    });
  };

  window.followUser = async (targetUid) => {
    if(!currentUser) return alert('Login dulu!');
    await updateDoc(doc(db, 'users', currentUser.uid), { following: arrayUnion(targetUid), followingCount: currentUser.followingCount + 1 });
    const targetRef = doc(db, 'users', targetUid);
    const tSnap = await getDoc(targetRef);
    await updateDoc(targetRef, { followers: arrayUnion(currentUser.uid), followersCount: tSnap.data().followersCount + 1 });
    alert('Berhasil Follow!');
    document.getElementById('searchModal').classList.remove('active');
  };

  window.openUserProfile = async (uid) => {
    if(!currentUser) return;
    if(uid === currentUser.uid) return document.querySelector('[data-tab="profil"]').click();
    if(confirm('Buka Profil orang ini? Klik OK untuk lanjut.')) {
      const snap = await getDoc(doc(db, 'users', uid));
      if(snap.exists()) {
        const u = snap.data();
        document.getElementById('profileName').textContent = u.name;
        document.getElementById('profileUser').textContent = '@' + u.username;
        // Sembunyiin tombol edit, ganti jadi Block/Report
        document.querySelector('.tg-actions').innerHTML = `
          <button class="btn btn-outline" onclick="blockUser('${uid}')" style="color:red; border-color:red;">Blokir</button>
        `;
        document.querySelector('[data-tab="profil"]').click();
      }
    }
  };

  window.blockUser = async (uid) => {
    if(confirm('Blokir user ini? Postingan mereka tidak akan muncul.')) {
      await updateDoc(doc(db, 'users', currentUser.uid), { blocked: arrayUnion(uid) });
      alert('User diblokir.'); window.location.reload();
    }
  };

  // PREMIUM TRIAL (+ KONFETI)
  document.getElementById('btnPremium').onclick = () => document.getElementById('premiumModal').classList.add('active');
  document.getElementById('btnClaimTrial').onclick = async () => {
    if(localStorage.getItem('trial_used')) return alert('Trial cuma 1x per HP!');
    if(!currentUser) return;
    await updateDoc(doc(db, 'users', currentUser.uid), { isPremium: true, isVerified: true });
    localStorage.setItem('trial_used', 'true');
    triggerConfetti();
    alert('Premium Aktif! Cek Centang Biru & Banner lu.');
    setTimeout(() => window.location.reload(), 2000);
  };

  function triggerConfetti() {
    for(let i=0; i<30; i++) {
      let el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.top = '-10px';
      el.style.width = '10px'; el.style.height = '10px';
      el.style.backgroundColor = ['#fbbf24', '#ec4899', '#3b82f6', '#22c55e'][Math.floor(Math.random()*4)];
      el.style.zIndex = 9999;
      el.style.transition = 'transform 2s linear, opacity 2s';
      document.body.appendChild(el);
      setTimeout(() => {
        el.style.transform = `translateY(100vh) rotate(${Math.random()*360}deg)`;
        el.style.opacity = 0;
      }, 10);
      setTimeout(() => el.remove(), 2000);
    }
  }

  // --- CHAT LOGIC (FASE 2) ---
  const chatOverlay = document.getElementById('chatOverlay');
  const chatInput = document.getElementById('chatInput');
  const emojiPicker = document.getElementById('emojiPicker');
  const chatStatus = document.getElementById('chatStatus');

  const emojis = ['😀','😂','🥰','😎','😭','😡','👍','❤️','🔥','🎉','✨','🙏','💩','👻','💀','🤖'];
  emojis.forEach(e => emojiPicker.innerHTML += `<span>${e}</span>`);
  emojiPicker.querySelectorAll('span').forEach(span => {
    span.onclick = () => { chatInput.value += span.innerText; chatInput.focus(); };
  });
  document.getElementById('btnEmoji').onclick = () => {
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';
  };

  document.getElementById('openHzcs').onclick = () => openChat('hzcs_uid', 'HZCS Official');
  document.getElementById('btnBackChat').onclick = () => { chatOverlay.classList.remove('active'); activeChatUid = null; };

  function openChat(uid, name) {
    activeChatUid = uid;
    document.getElementById('chatTitle').textContent = name;
    chatOverlay.classList.add('active');
    const box = document.getElementById('chatMessages');
    
    onSnapshot(query(collection(db, 'messages'), orderBy('createdAt', 'asc')), (snap) => {
      box.innerHTML = '';
      snap.forEach(d => {
        const m = d.data();
        if(m.participants.includes(currentUser?.uid || 'guest') && m.participants.includes(uid)) {
          const isMe = m.senderId === currentUser?.uid;
          const time = m.createdAt ? new Date(m.createdAt.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
          
          if(!isMe && !m.read && currentUser) { updateDoc(doc(db, 'messages', d.id), { read: true }); }
          
          let reactionHtml = '';
          if(m.reactions) {
            for(const [emo, users] of Object.entries(m.reactions)) {
              if(users.length > 0) reactionHtml += `<span style="font-size:12px; background:#333; padding:2px 6px; border-radius:10px; margin-left:5px;">${emo} ${users.length}</span>`;
            }
          }

          box.innerHTML += `
            <div class="chat-msg ${isMe?'me':'them'}" data-id="${d.id}">
              <div class="chat-bubble" oncontextmenu="event.preventDefault(); showReaction('${d.id}')">
                ${m.text}
                ${reactionHtml ? `<div style="margin-top:5px;">${reactionHtml}</div>` : ''}
              </div>
              <div class="chat-meta">
                ${time}
                ${isMe ? (m.read ? '<i class="bi bi-check2-all read"></i>' : '<i class="bi bi-check2"></i>') : ''}
              </div>
            </div>`;
        }
      });
      box.scrollTop = box.scrollHeight;
    });

    onSnapshot(doc(db, 'users', uid), (userSnap) => {
      if(userSnap.exists()) {
        const u = userSnap.data();
        if(u.typingIn === currentUser.uid) {
          chatStatus.textContent = 'Sedang mengetik...';
          chatStatus.style.color = 'var(--primary)';
        } else {
          chatStatus.style.color = '#888';
          if(u.lastSeen) {
            const diff = Math.floor((Date.now() - u.lastSeen.toDate().getTime()) / 1000);
            if(diff < 60) chatStatus.textContent = 'Online';
            else chatStatus.textContent = `Terakhir dilihat ${Math.floor(diff/60)} mnt lalu`;
          } else chatStatus.textContent = 'Offline';
        }
      }
    });
  }

  chatInput.addEventListener('input', () => {
    if(!currentUser || !activeChatUid) return;
    updateDoc(doc(db, 'users', currentUser.uid), { typingIn: activeChatUid });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null }); }, 2000);
  });

  window.showReaction = (msgId) => {
    const reaction = prompt('Kasih reaksi (ketik: ❤️, 👍, atau 😂):');
    if(!reaction || !currentUser) return;
    getDoc(doc(db, 'messages', msgId)).then(snap => {
      if(snap.exists()) {
        let reactions = snap.data().reactions || {};
        if(!reactions[reaction]) reactions[reaction] = [];
        if(!reactions[reaction].includes(currentUser.uid)) {
          reactions[reaction].push(currentUser.uid);
          updateDoc(doc(db, 'messages', msgId), { reactions });
        }
      }
    });
  };

  document.getElementById('btnSendChat').onclick = async () => {
    if(!chatInput.value || !currentUser) return;
    const text = chatInput.value;
    chatInput.value = '';
    await updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null });
    await addDoc(collection(db, 'messages'), {
      participants: [currentUser.uid, activeChatUid], senderId: currentUser.uid, text: text, read: false, createdAt: serverTimestamp()
    });
  };
}
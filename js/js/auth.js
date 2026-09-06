// js/auth.js

const Auth = {
    checkUserSession: function() {
        const btnReg = document.getElementById('regBtnText');
        const userDropdownContainer = document.getElementById('userDropdownContainer');
        const menuBtn = document.getElementById('user-menu-btn');

        if (currentUser) {
            if (btnReg) btnReg.style.display = 'none';
            if (userDropdownContainer) userDropdownContainer.style.display = 'inline-block';

            let firstName = currentUser.name ? currentUser.name.split(' ')[0] : 'أهلاً';
            let fullName = currentUser.name || 'مستخدم رمال';

            const headerFirstNameEl = document.getElementById('headerFirstName');
            const headerFullNameEl = document.getElementById('headerFullName');
            if (headerFirstNameEl) headerFirstNameEl.innerText = firstName;
            if (headerFullNameEl) headerFullNameEl.innerText = fullName;
            
            const dashUserNameEl = document.getElementById('dashUserName');
            if (dashUserNameEl) dashUserNameEl.innerText = fullName;
            
            let pts = currentUser.points || 500;
            let ptsAED = (pts / 10).toFixed(2);
            
            const dropdownPointsEl = document.getElementById('dropdownPoints');
            if (dropdownPointsEl) dropdownPointsEl.innerText = pts;
            
            const dropdownPointsAEDEl = document.getElementById('dropdownPointsAED');
            if (dropdownPointsAEDEl) dropdownPointsAEDEl.innerText = ptsAED;
            
            const dashPointsDisplayEl = document.getElementById('dashPointsDisplay');
            if (dashPointsDisplayEl) dashPointsDisplayEl.innerText = pts;

            const dashPointsAEDDisplayEl = document.getElementById('dashPointsAEDDisplay');
            if (dashPointsAEDDisplayEl) dashPointsAEDDisplayEl.innerText = ptsAED;

            if (menuBtn) { menuBtn.classList.remove('hidden'); menuBtn.classList.add('flex'); }

            if (typeof Auth !== 'undefined' && Auth.renderSavedCardsDropdown) Auth.renderSavedCardsDropdown();
            Auth.fetchUserData();
        } else {
            if (btnReg) btnReg.style.display = 'inline-block';
            if (userDropdownContainer) userDropdownContainer.style.display = 'none';
        }
    },

    openAuthModal: function() { 
        const modal = document.getElementById('socialModal');
        modal.classList.remove('hidden'); modal.classList.add('flex');
        Auth.switchAuthTab('register'); 
    },
    
    closeAuthModal: function() { 
        const modal = document.getElementById('socialModal');
        modal.classList.add('hidden'); modal.classList.remove('flex');
    },

    switchAuthTab: function(tab) {
        const tabRegister = document.getElementById('tabRegisterBtn');
        const tabLogin = document.getElementById('tabLoginBtn');
        const registerForm = document.getElementById('registerForm');
        const loginForm = document.getElementById('loginForm');
        const modalTitle = document.getElementById('modalTitle');
        const modalSubtitle = document.getElementById('modalSubtitle');

        const activeStyle = "flex-1 py-2 md:py-3 bg-white rounded-lg md:rounded-xl shadow-sm text-[#00b4d8] font-black text-xs md:text-sm transition-all duration-300 border-none cursor-pointer";
        const inactiveStyle = "flex-1 py-2 md:py-3 text-slate-400 font-bold text-xs md:text-sm hover:text-slate-600 transition-all duration-300 border-none cursor-pointer bg-transparent";

        if (tab === 'register') {
            tabRegister.className = activeStyle; tabLogin.className = inactiveStyle;
            registerForm.className = 'space-y-3 md:space-y-4 block animate-fade-in-up'; loginForm.className = 'space-y-3 md:space-y-4 hidden';
            modalTitle.innerHTML = 'فتح حساب جديد 🌴'; modalSubtitle.innerHTML = 'سجل الآن واحصل على رصيد ترحيبي!';
        } else {
            tabLogin.className = activeStyle; tabRegister.className = inactiveStyle;
            registerForm.className = 'space-y-3 md:space-y-4 hidden'; loginForm.className = 'space-y-3 md:space-y-4 block animate-fade-in-up';
            modalTitle.innerHTML = 'تسجيل الدخول 🔓'; modalSubtitle.innerHTML = 'مرحباً بعودتك إلى عالمك!';
        }
    },

    togglePasswordVisibility: function(inputId, btn) {
        const input = document.getElementById(inputId);
        const icon = btn.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye', 'text-[#00b4d8]');
        } else {
            input.type = 'password';
            icon.classList.remove('fa-eye', 'text-[#00b4d8]'); icon.classList.add('fa-eye-slash');
        }
    },

    openEditEmailModal: function() { document.getElementById('editEmailModal').classList.remove('hidden'); document.getElementById('editEmailModal').classList.add('flex'); document.getElementById('emailStep1').style.display = 'block'; document.getElementById('emailStep2').style.display = 'none'; },
    closeEditEmailModal: function() { document.getElementById('editEmailModal').classList.add('hidden'); document.getElementById('editEmailModal').classList.remove('flex'); },

    requestEmailChangeOTP: async function() {
        const newEmail = document.getElementById('newEmailInput').value.trim();
        if(!newEmail) return UI.showToast('error', 'تنبيه', 'الرجاء إدخال البريد الجديد');
        try {
            const res = await fetch(`${API_URL}/api/user/request-email-change`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentEmail: currentUser.email, newEmail }) });
            const data = await res.json();
            if(data.success) { UI.showToast('success', 'تم الإرسال', data.message); document.getElementById('emailStep1').style.display = 'none'; document.getElementById('emailStep2').style.display = 'block'; } else { UI.showToast('error', 'فشل الإرسال', data.error); }
        } catch(e) { UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); }
    },

    verifyAndChangeEmail: async function() {
        const code = document.getElementById('emailOtpInput').value.trim();
        try {
            const res = await fetch(`${API_URL}/api/user/confirm-email-change`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentEmail: currentUser.email, code }) });
            const data = await res.json();
            if(data.success) { UI.showToast('success', 'تم التحديث', data.message); currentUser = data.user; localStorage.setItem('rimal_current_user', JSON.stringify(currentUser)); Auth.closeEditEmailModal(); Auth.checkUserSession(); } else { UI.showToast('error', 'فشل التحديث', data.error); }
        } catch(e) { UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); }
    },

    openEditPasswordModal: function() { document.getElementById('editPasswordModal').classList.remove('hidden'); document.getElementById('editPasswordModal').classList.add('flex'); document.getElementById('passStep1').style.display = 'block'; document.getElementById('passStep2').style.display = 'none'; },
    closeEditPasswordModal: function() { document.getElementById('editPasswordModal').classList.add('hidden'); document.getElementById('editPasswordModal').classList.remove('flex'); },

    requestPasswordChangeOTP: async function() {
        try {
            const res = await fetch(`${API_URL}/api/user/request-password-change`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email: currentUser.email }) });
            const data = await res.json();
            if(data.success) { UI.showToast('success', 'تم الإرسال', data.message); document.getElementById('passStep1').style.display = 'none'; document.getElementById('passStep2').style.display = 'block'; } else { UI.showToast('error', 'فشل الإرسال', data.error); }
        } catch(e) { UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); }
    },

    verifyAndChangePassword: async function() {
        const code = document.getElementById('passOtpInput').value.trim();
        const newPassword = document.getElementById('newPasswordInput').value.trim();
        if(!newPassword) return UI.showToast('error', 'تنبيه', 'أدخل كلمة المرور الجديدة');
        try {
            const res = await fetch(`${API_URL}/api/user/confirm-password-change`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email: currentUser.email, code, newPassword }) });
            const data = await res.json();
            if(data.success) { UI.showToast('success', 'تم التحديث', data.message); Auth.closeEditPasswordModal(); } else { UI.showToast('error', 'فشل التحديث', data.error); }
        } catch(e) { UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); }
    },

    openSavedCardsModal: function() { document.getElementById('savedCardsModal').classList.remove('hidden'); document.getElementById('savedCardsModal').classList.add('flex'); Auth.renderSavedCardsList(); },
    closeSavedCardsModal: function() { document.getElementById('savedCardsModal').classList.add('hidden'); document.getElementById('savedCardsModal').classList.remove('flex'); },

    saveNewCreditCard: async function() {
        const cardHolder = document.getElementById('cardHolderName').value.trim();
        const cardNumber = document.getElementById('cardNumberInput').value.trim();
        if(!cardHolder || cardNumber.length < 16) return UI.showToast('error', 'تنبيه', 'الرجاء إدخال اسم حامل البطاقة ورقم بطاقة صحيح (16 رقم)');
        try {
            const res = await fetch(`${API_URL}/api/user/save-card`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email: currentUser.email, cardHolder, cardNumber }) });
            const data = await res.json();
            if(data.success) { UI.showToast('success', 'تم الحفظ', data.message); currentUser.savedCards = data.savedCards; localStorage.setItem('rimal_current_user', JSON.stringify(currentUser)); document.getElementById('cardHolderName').value = ''; document.getElementById('cardNumberInput').value = ''; Auth.renderSavedCardsList(); Auth.renderSavedCardsDropdown(); } else { UI.showToast('error', 'فشل الحفظ', data.error); }
        } catch(e) { UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); }
    },

    deleteSavedCard: async function(cardId) {
        if(!confirm('هل أنت متأكد من حذف هذه البطاقة؟')) return;
        try {
            const res = await fetch(`${API_URL}/api/user/delete-card`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email: currentUser.email, cardId }) });
            const data = await res.json();
            if(data.success) { UI.showToast('success', 'تم الحذف', 'تم حذف البطاقة بنجاح'); currentUser.savedCards = data.savedCards; localStorage.setItem('rimal_current_user', JSON.stringify(currentUser)); Auth.renderSavedCardsList(); Auth.renderSavedCardsDropdown(); } else { UI.showToast('error', 'فشل الحذف', data.error); }
        } catch(e) { UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); }
    },

    renderSavedCardsList: function() {
        const container = document.getElementById('savedCardsListContainer');
        if (!container) return;
        container.innerHTML = '';
        if(!currentUser.savedCards || currentUser.savedCards.length === 0) {
            container.innerHTML = '<p class="text-xs text-gray-500 text-center font-bold">لا توجد بطاقات محفوظة حالياً.</p>'; return;
        }
        currentUser.savedCards.forEach(card => {
            container.innerHTML += `
                <div class="bg-gray-50 p-2 md:p-3 rounded-lg md:rounded-xl border border-gray-200 mb-2 flex justify-between items-center">
                    <div class="text-right text-[#1f3a40]"><strong class="text-xs md:text-sm">${card.cardHolder}</strong><br><span class="text-[10px] md:text-xs text-gray-500" dir="ltr">${card.maskedNumber}</span></div>
                    <button onclick="Auth.deleteSavedCard('${card._id}')" class="bg-red-50 hover:bg-red-100 text-red-500 border-none px-2 py-1 md:px-3 md:py-1.5 rounded-md md:rounded-lg font-bold cursor-pointer text-[10px] md:text-xs transition">حذف 🗑️</button>
                </div>`;
        });
    },

    renderSavedCardsDropdown: function() {
        const section = document.getElementById('savedCardsPaymentSection');
        const select = document.getElementById('savedCardsSelect');
        if (!section || !select) return;
        select.innerHTML = '<option value="" dir="rtl">-- اختر بطاقة محفوظة --</option>';
        if(currentUser && currentUser.savedCards && currentUser.savedCards.length > 0) {
            section.style.display = 'block';
            currentUser.savedCards.forEach(card => { select.innerHTML += `<option value="${card.cardToken}">${card.cardHolder} (${card.maskedNumber})</option>`; });
        } else { section.style.display = 'none'; }
    },

    handleDirectLogin: async function(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        try {
            const res = await fetch(`${API_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
            const data = await res.json();
            if(data.success) { currentUser = data.user; localStorage.setItem('rimal_current_user', JSON.stringify(currentUser)); Auth.closeAuthModal(); Auth.checkUserSession(); UI.switchView('registerView'); UI.showToast('success', 'مرحباً بعودتك!', 'تم تسجيل الدخول بنجاح.'); } else { UI.showToast('error', 'فشل الدخول', data.error || 'تأكد من صحة البيانات'); }
        } catch(err) { UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); }
    },

    requestVerificationCode: async function(e) {
        e.preventDefault();
        const name = document.getElementById('modalName').value;
        const email = document.getElementById('modalEmail').value;
        const password = document.getElementById('modalPassword').value;
        const phone = document.getElementById('modalPhone').value;
        try {
            const res = await fetch(`${API_URL}/api/auth/register-send-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, phone }) });
            const data = await res.json();
            if(data.success) {
                let code = prompt('📩 تم إرسال كود التحقق الثنائي (OTP) إلى بريدك الإلكتروني. أدخل الـ 6 أرقام هنا:');
                if(code) {
                    const verifyRes = await fetch(`${API_URL}/api/auth/verify-and-register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
                    const verifyData = await verifyRes.json();
                    if(verifyData.success) { currentUser = verifyData.user; localStorage.setItem('rimal_current_user', JSON.stringify(currentUser)); Auth.closeAuthModal(); Auth.checkUserSession(); UI.switchView('registerView'); UI.showToast('success', 'حساب جديد', 'تم تفعيل الحساب وإضافة 500 نقطة لحصالتك!'); } else { UI.showToast('error', 'خطأ بالتحقق', 'كود التحقق غير صحيح أو انتهت صلاحيته.'); }
                }
            } else { UI.showToast('error', 'حدث خطأ', data.error); }
        } catch(err) { UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالسيرفر.'); }
    },

    fetchUserData: async function() {
        if(!currentUser) return;
        const bookingsContainer = document.getElementById('bookingsContainer');
        if (!bookingsContainer) return;
        
        bookingsContainer.innerHTML = `<div class="flex justify-center items-center py-12 md:py-16"><div class="animate-spin rounded-full h-8 w-8 md:h-10 md:w-10 border-b-4 border-[#00b4d8]"></div><span class="mr-3 md:mr-4 text-[#1f3a40] font-black text-sm md:text-lg">جاري جلب حجوزاتك الفاخرة...</span></div>`;
        
        try {
            const res = await fetch(`${API_URL}/api/user/profile?email=${encodeURIComponent(currentUser.email)}`);
            const data = await res.json();
            
            if(data.success) {
                currentUser.points = data.profile.points;
                currentUser.savedCards = data.profile.savedCards;
                localStorage.setItem('rimal_current_user', JSON.stringify(currentUser));
                
                let pts = currentUser.points || 500; 
                let ptsAED = (pts / 10).toFixed(2);
                
                const dashPointsDisplayEl = document.getElementById('dashPointsDisplay');
                if (dashPointsDisplayEl) dashPointsDisplayEl.innerText = pts;
                const dashPointsAEDDisplayEl = document.getElementById('dashPointsAEDDisplay');
                if (dashPointsAEDDisplayEl) dashPointsAEDDisplayEl.innerText = ptsAED;
                
                // بقية منطق عرض الحجوزات (سيتم وضعه لاحقاً في main.js لتجنب التكرار الطويل هنا)
                // تم إخفاء باقي بناء HTML الحجوزات لتسهيل القراءة، سننقله لملف main أو hotels.
                if(typeof window.renderBookingsList === 'function') window.renderBookingsList(data.bookings, bookingsContainer);
            } else { 
                bookingsContainer.innerHTML = `<div class="text-center py-8 md:py-12 text-red-500 bg-red-50 rounded-xl md:rounded-2xl font-bold border border-red-100 shadow-sm text-xs md:text-sm">حدث خطأ أثناء جلب البيانات: ${data.error || 'يرجى المحاولة لاحقاً.'}</div>`; 
            }
        } catch(e) { 
            console.error('خطأ', e); 
            bookingsContainer.innerHTML = `<div class="text-center py-8 md:py-12 text-red-500 bg-red-50 rounded-xl md:rounded-2xl font-bold border border-red-100 shadow-sm text-xs md:text-sm">حدث خطأ غير متوقع في الاتصال بالسيرفر.</div>`; 
        }
    },

    logoutUser: function() { 
        localStorage.removeItem('rimal_current_user'); 
        currentUser = null; 
        Auth.checkUserSession(); 
        UI.switchView('mainView'); 
        UI.showToast('info', 'وداعاً', 'تم تسجيل الخروج من حسابك بنجاح.'); 
    }
};

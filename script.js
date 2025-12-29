document.addEventListener('DOMContentLoaded', () => {
    
    /* 0. Preloader Injection (Rei do Xadrez) */
    document.body.classList.add('loading'); // Trava o scroll inicialmente
    const preloaderHTML = `
    <div id="preloader" role="status" aria-label="Carregando">
        <span class="king">♔</span>
    </div>`;
    document.body.insertAdjacentHTML('afterbegin', preloaderHTML);

    window.addEventListener('load', () => {
        document.body.classList.remove("loading");
        const p = document.getElementById("preloader");
        if (p) p.classList.add("hide");
        setTimeout(() => { if (p) p.remove(); }, 300);
    });

    /* 1. Animações de Scroll */
    const animatedElements = document.querySelectorAll('.slide-in-left, .slide-in-right, .fade-in');
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                obs.unobserve(entry.target);
            }
        });
    }, { root: null, rootMargin: '0px', threshold: 0.1 });
    animatedElements.forEach(el => observer.observe(el));

    /* 2. Header Scroll */
    const header = document.getElementById('header');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });

    /* 3. Glow Effect */
    const root = document.documentElement;
    const supportsReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!supportsReducedMotion) {
        const updateGlow = (x, y) => {
            root.style.setProperty('--glow-x', `${x}%`);
            root.style.setProperty('--glow-y', `${y}%`);
        };

        window.addEventListener('mousemove', (event) => {
            const x = (event.clientX / window.innerWidth) * 100;
            const y = (event.clientY / window.innerHeight) * 100;
            updateGlow(x, y);
        });

        window.addEventListener('touchmove', (event) => {
            if (!event.touches.length) return;
            const touch = event.touches[0];
            const x = (touch.clientX / window.innerWidth) * 100;
            const y = (touch.clientY / window.innerHeight) * 100;
            updateGlow(x, y);
        }, { passive: true });
    }

    /* 4. Smooth Scroll */
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                const headerOffset = 100;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                window.scrollTo({ top: offsetPosition, behavior: "smooth" });
            }
        });
    });

    /* 5. Chat Window */
    const chatWindow = document.getElementById('chat-window');
    const chatBody = document.getElementById('chat-body');
    const chatInput = document.getElementById('chat-input');
    const sendChat = document.getElementById('send-chat');
    const apiEndpoint = 'api.php';
    const fetchNoCache = { cache: 'no-store' };
    const printButton = document.createElement('button');
    printButton.innerHTML = '<i class="fas fa-print"></i>';
    printButton.classList.add('print-chat');
    document.querySelector('.chat-header').appendChild(printButton);

    let clientId = null;
    let currentMessages = [];
    let lastServerMessageId = 0;
    const renderedMessageIds = new Set();
    const renderedMessageElements = new Map();
    const pendingMessages = [];
    const pendingServerMessages = [];

    const isNearBottom = () => {
        const threshold = 24;
        return chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < threshold;
    };

    const initializeChat = async () => {
        chatBody.innerHTML = '';
        renderedMessageIds.clear();
        renderedMessageElements.clear();
        pendingMessages.length = 0;
        lastServerMessageId = 0;
        try {
            const response = await fetch(`${apiEndpoint}?action=get-initial-message`, fetchNoCache);
            if (response.ok) {
                const data = await response.json();
                clientId = data.clientId;
            } else {
                console.error('Error getting initial message');
            }
        } catch (error) {
            console.error('Error getting initial message:', error);
        }
        await pollMessages(true);
    };

    const pollMessages = async (forceScroll = false) => {
        if (!clientId) return;

        try {
            const response = await fetch(`${apiEndpoint}?action=get-client-messages&clientId=${encodeURIComponent(clientId)}`, fetchNoCache);
            if (response.ok) {
                const messages = await response.json();
                currentMessages = messages;
                const shouldScroll = forceScroll || isNearBottom();
                let appendedServerMessage = false;

                messages.forEach(msg => {
                    const messageId = Number(msg.id) || 0;
                    if (messageId && renderedMessageIds.has(messageId)) {
                        if (msg.is_client_message && renderedMessageElements.has(messageId)) {
                            const element = renderedMessageElements.get(messageId);
                            updateReadReceipt(element, msg);
                        }
                        return;
                    }

                    if (msg.is_client_message) {
                        const pendingIndex = pendingMessages.findIndex(
                            (pending) => pending.text === msg.message && messageId > pending.minId
                        );
                        if (pendingIndex !== -1) {
                            const pending = pendingMessages.splice(pendingIndex, 1)[0];
                            const element = pending.element;
                            element.dataset.messageId = messageId.toString();
                            renderedMessageIds.add(messageId);
                            renderedMessageElements.set(messageId, element);
                            updateReadReceipt(element, msg);
                            return;
                        }
                    } else {
                        const pendingIndex = pendingServerMessages.findIndex(
                            (pending) => pending.text === msg.message && messageId > pending.minId
                        );
                        if (pendingIndex !== -1) {
                            const pending = pendingServerMessages.splice(pendingIndex, 1)[0];
                            const element = pending.element;
                            element.dataset.messageId = messageId.toString();
                            renderedMessageIds.add(messageId);
                            renderedMessageElements.set(messageId, element);
                            appendedServerMessage = true;
                            return;
                        }
                    }

                    const className = msg.is_client_message ? 'client-message' : 'server-message';
                    const readReceipt = msg.is_client_message && msg.read ? ' <i class="fas fa-check-double"></i>' : '';
                    const element = appendMessage(msg.message + readReceipt, className, shouldScroll, {
                        rawText: msg.message,
                        messageId: messageId || null
                    });
                    if (messageId) {
                        renderedMessageIds.add(messageId);
                        renderedMessageElements.set(messageId, element);
                    }
                    if (!msg.is_client_message) {
                        appendedServerMessage = true;
                    }
                });

                const maxId = messages.reduce((max, msg) => {
                    const id = Number(msg.id) || 0;
                    return id > max ? id : max;
                }, lastServerMessageId);
                lastServerMessageId = maxId;
                if (appendedServerMessage && !shouldScroll) {
                    chatBody.scrollTop = chatBody.scrollHeight;
                }

            } else {
                console.error('Error fetching messages');
            }
        } catch (error) {
            console.error('Error fetching messages:', error);
        }
    };

    setInterval(pollMessages, 3000);

    const showTypingIndicator = () => {
        const typingIndicator = document.createElement('div');
        typingIndicator.classList.add('chat-message', 'server-message', 'typing-indicator');
        typingIndicator.innerHTML = '<span></span><span></span><span></span>';
        chatBody.appendChild(typingIndicator);
        chatBody.scrollTop = chatBody.scrollHeight;
    };

    const removeTypingIndicator = () => {
        const typingIndicator = document.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    };

    const sendMessage = async () => {
        const message = chatInput.value.trim();
        if (message === '') return;

        const clientElement = appendMessage(message, 'client-message', true, { rawText: message });
        pendingMessages.push({ text: message, element: clientElement, minId: lastServerMessageId });
        chatInput.value = '';
        showTypingIndicator();

        try {
            const response = await fetch(`${apiEndpoint}?action=send-message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message, clientId })
            });

            removeTypingIndicator();

            if (response.ok) {
                let data = null;
                try {
                    data = await response.json();
                } catch (parseError) {
                    console.error('Error parsing send-message response:', parseError);
                }
                if (data && data.message) {
                    const serverElement = appendMessage(data.message, 'server-message', true, { rawText: data.message });
                    pendingServerMessages.push({ text: data.message, element: serverElement, minId: lastServerMessageId });
                }
                await pollMessages(true); // force scroll to reveal the bot response
            } else {
                console.error('Error sending message');
            }
        } catch (error) {
            removeTypingIndicator();
            console.error('Error sending message:', error);
        }
    };

    const appendMessage = (message, className, shouldScroll = true, meta = {}) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', className);
        messageElement.innerHTML = message;
        if (meta.rawText) {
            messageElement.dataset.rawText = meta.rawText;
        }
        if (meta.messageId) {
            messageElement.dataset.messageId = String(meta.messageId);
        }
        chatBody.appendChild(messageElement);
        if (shouldScroll) {
            chatBody.scrollTop = chatBody.scrollHeight;
        }
        return messageElement;
    };

    const updateReadReceipt = (element, msg) => {
        if (!element || !msg || !msg.is_client_message) return;
        const rawText = element.dataset.rawText || msg.message || '';
        const readReceipt = msg.read ? ' <i class="fas fa-check-double"></i>' : '';
        element.innerHTML = rawText + readReceipt;
    };

    if (sendChat) {
        sendChat.addEventListener('click', sendMessage);
    }

    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }

    printButton.addEventListener('click', () => {
        const chatContent = chatBody.innerHTML;
        const printWindow = window.open('', '', 'height=600,width=800');
        printWindow.document.write('<html><head><title>Transcrição da Conversa</title>');
        printWindow.document.write('<link rel="stylesheet" href="style.css">');
        printWindow.document.write('</head><body>');
        printWindow.document.write(chatContent);
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.print();
    });

    /* 6. Injeção de Botões Flutuantes (WhatsApp + Back to Top) */
    const addFloatingButtons = () => {
        // WhatsApp
        const waLink = document.createElement('a');
        waLink.href = 'https://wa.me/5511948715839'; // Substitua pelo número real
        waLink.className = 'whatsapp-float';
        waLink.target = '_blank';
        waLink.innerHTML = '<i class="fab fa-whatsapp"></i>';
        document.body.appendChild(waLink);

        // Back to Top
        const topBtn = document.createElement('div');
        topBtn.className = 'back-to-top';
        topBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        topBtn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
        document.body.appendChild(topBtn);

        // Lógica de aparecer/desaparecer
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                topBtn.classList.add('show');
            } else {
                topBtn.classList.remove('show');
            }
        });
    };
    addFloatingButtons();

    initializeChat();
});

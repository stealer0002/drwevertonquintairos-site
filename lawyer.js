document.addEventListener('DOMContentLoaded', async () => {
    const messagesContainer = document.getElementById('messages-container');
    const modal = document.getElementById('response-modal');
    const closeModal = document.querySelector('.close-modal');
    const sendResponseBtn = document.getElementById('send-response');
    const responseText = document.getElementById('response-text');
    const conversationHistory = document.getElementById('conversation-history');
    const conversationTitle = document.getElementById('conversation-title');
    const conversationMeta = document.getElementById('conversation-meta');
    const apiEndpoint = '/api.php';
    let currentClientId = null;
    let allClientMessages = [];
    let currentConversationMessages = [];
    const deletedMessageIds = new Set();
    const seenMessageIds = new Set();
    const highlightUntil = new Map();
    const defaultTitle = document.title;
    let audioContext = null;
    let hasUserInteracted = false;
    let titleResetTimer = null;
    let isRefreshing = false;

    const registerUserInteraction = () => {
        hasUserInteracted = true;
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    };

    document.addEventListener('click', registerUserInteraction, { once: true });
    document.addEventListener('keydown', registerUserInteraction, { once: true });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            document.title = defaultTitle;
        }
    });

    // Adicionar botão de limpar histórico no modal
    const clearHistoryBtn = document.createElement('button');
    clearHistoryBtn.innerHTML = '<i class="fas fa-trash"></i> Limpar Histórico';
    clearHistoryBtn.className = 'clear-chat';
    clearHistoryBtn.style.fontSize = '0.9rem';
    clearHistoryBtn.style.marginLeft = '15px';
    document.querySelector('.modal-header').appendChild(clearHistoryBtn);

    // Botão global de apagar tudo
    const globalClearBtn = document.createElement('button');
    globalClearBtn.innerHTML = '<i class="fas fa-trash"></i> Apagar Tudo';
    globalClearBtn.style.backgroundColor = '#d32f2f';
    globalClearBtn.style.color = '#fff';
    globalClearBtn.style.border = 'none';
    globalClearBtn.style.padding = '10px 15px';
    globalClearBtn.style.borderRadius = '4px';
    globalClearBtn.style.cursor = 'pointer';
    globalClearBtn.style.marginBottom = '15px';
    globalClearBtn.style.display = 'block';
    globalClearBtn.style.marginLeft = 'auto';
    messagesContainer.parentNode.insertBefore(globalClearBtn, messagesContainer);

    const escapeHTML = (unsafe) =>
        unsafe
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

    const playNotificationSound = () => {
        if (!hasUserInteracted) return;
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        try {
            if (!audioContext) {
                audioContext = new Context();
            }
            if (audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
            }
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = 880;
            gain.gain.value = 0.05;
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.15);
        } catch (error) {
            console.error('Error playing notification sound:', error);
        }
    };

    const showBrowserNotification = (title, body) => {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission !== 'granted') return;
        try {
            new Notification(title, { body });
        } catch (error) {
            console.error('Error showing notification:', error);
        }
    };

    const updateDocumentTitle = (count) => {
        if (!document.hidden) return;
        document.title = `(${count}) ${defaultTitle}`;
        if (titleResetTimer) {
            clearTimeout(titleResetTimer);
        }
        titleResetTimer = setTimeout(() => {
            document.title = defaultTitle;
        }, 8000);
    };

    const formatTimestamp = (timestamp) => {
        if (!timestamp) return '';
        const raw = String(timestamp);
        const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
        const date = new Date(normalized);
        if (Number.isNaN(date.getTime())) return String(timestamp);
        return date.toLocaleString('pt-BR');
    };

    const processNewMessages = (messages, notify) => {
        const newClientMessages = [];
        const now = Date.now();
        messages.forEach(msg => {
            const messageId = Number(msg.id) || 0;
            if (!messageId || seenMessageIds.has(messageId)) {
                return;
            }
            seenMessageIds.add(messageId);
            if (notify && msg.is_client_message && !msg.read) {
                newClientMessages.push(msg);
                highlightUntil.set(messageId, now + 10000);
            }
        });
        return newClientMessages;
    };

    const refreshClientList = async (options = {}) => {
        if (isRefreshing) return;
        isRefreshing = true;
        const notify = Boolean(options.notify);
        try {
            const response = await fetch(`${apiEndpoint}?action=get-messages`, { cache: 'no-store' });
            if (response.ok) {
                const messages = await response.json();
                allClientMessages = messages;
                const newClientMessages = processNewMessages(messages, notify);
                displayMessages(messages);

                if (notify && newClientMessages.length) {
                    playNotificationSound();
                    updateDocumentTitle(newClientMessages.length);
                    if (newClientMessages.length === 1) {
                        const msg = newClientMessages[0];
                        const name = msg.client_name || 'Cliente';
                        const snippet = String(msg.message || '').slice(0, 120);
                        showBrowserNotification(`Nova mensagem de ${name}`, snippet);
                    } else {
                        showBrowserNotification('Novas mensagens', `${newClientMessages.length} novas mensagens na lista.`);
                    }
                }
            } else {
                console.error('Error fetching messages');
            }
        } catch (error) {
            console.error('Error fetching messages:', error);
        } finally {
            isRefreshing = false;
        }
    };

    await refreshClientList({ notify: false });
    setInterval(() => {
        refreshClientList({ notify: true });
    }, 5000);

    function displayMessages(messages) {
        messagesContainer.innerHTML = '';
        
        const visibleMessages = messages.filter(msg => !deletedMessageIds.has(msg.id));

        if (visibleMessages.length === 0) {
            messagesContainer.innerHTML = '<p>Nenhuma mensagem de cliente encontrada.</p>';
            return;
        }

        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th></th>
                    <th>Nome</th>
                    <th>Status do caso</th>
                    <th>Ultima atualizacao</th>
                    <th>Acoes</th>
                </tr>
            </thead>
            <tbody>
            </tbody>
        `;

        const tbody = table.querySelector('tbody');
        visibleMessages.forEach(msg => {
            const caseStatus = msg.last_case_status || msg.case_status || 'pendente';
            const statusClass = {
                urgente: 'status-urgent',
                delicado: 'status-delicate',
                simples: 'status-simple',
                pendente: 'status-pending'
            }[caseStatus] || 'status-pending';
            const statusLabel = {
                urgente: 'Urgente',
                delicado: 'Delicado',
                simples: 'Simples',
                pendente: 'Pendente'
            }[caseStatus] || 'Pendente';

            const row = document.createElement('tr');
            row.dataset.messageId = msg.id;
            row.dataset.clientId = msg.client_id;
            row.dataset.clientName = msg.client_name || 'Cliente';
            row.dataset.clientLocation = msg.client_location || '';
            row.dataset.clientPhone = msg.client_phone || '';
            row.classList.add(msg.read ? 'read' : 'unread');
            const highlightExpiry = highlightUntil.get(msg.id);
            if (highlightExpiry) {
                if (highlightExpiry > Date.now()) {
                    row.classList.add('new-message');
                } else {
                    highlightUntil.delete(msg.id);
                }
            }
            row.innerHTML = `
                <td><i class="fas ${msg.read ? 'fa-eye' : 'fa-eye-slash'}"></i></td>
                <td>${msg.client_name || ''}</td>
                <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
                <td>${formatTimestamp(msg.timestamp)}</td>
                <td><button class="respond-btn" data-id="${msg.client_id}" data-name="${msg.client_name || 'Cliente'}" data-location="${msg.client_location || ''}" data-phone="${msg.client_phone || ''}" data-message-id="${msg.id}">Abrir</button></td>
            `;
            tbody.appendChild(row);
        });

        messagesContainer.appendChild(table);

        document.querySelectorAll('.respond-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                openConversation({
                    clientId: e.target.dataset.id,
                    clientName: e.target.dataset.name || 'Cliente',
                    clientLocation: e.target.dataset.location || '',
                    clientPhone: e.target.dataset.phone || '',
                    messageId: e.target.dataset.messageId
                });
            });
        });

        document.querySelectorAll('tbody tr').forEach(row => {
            row.addEventListener('click', async (e) => {
                openConversation({
                    clientId: row.dataset.clientId,
                    clientName: row.dataset.clientName,
                    clientLocation: row.dataset.clientLocation,
                    clientPhone: row.dataset.clientPhone,
                    messageId: row.dataset.messageId
                });
            });
        });
    }

    async function markRowAsRead(messageId, rowElement) {
        if (!messageId) return;
        try {
            await fetch(`${apiEndpoint}?action=mark-as-read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ messageId })
            });
            if (rowElement) {
                rowElement.classList.remove('unread');
                rowElement.classList.add('read');
                const icon = rowElement.querySelector('i');
                if (icon) icon.className = 'fas fa-eye';
            }
        } catch (error) {
            console.error('Error marking message as read:', error);
        }
    }

    async function loadConversation(clientId) {
        conversationHistory.innerHTML = '<p>Carregando conversa...</p>';
        try {
            const resp = await fetch(`${apiEndpoint}?action=get-client-messages&clientId=${encodeURIComponent(clientId)}`);
            if (!resp.ok) {
                conversationHistory.innerHTML = '<p>Erro ao carregar conversa.</p>';
                return;
            }
            const history = await resp.json();
            if (!history.length) {
                conversationHistory.innerHTML = '<p>Nenhuma mensagem registrada para este cliente.</p>';
                return;
            }
            
            currentConversationMessages = history;
            conversationHistory.innerHTML = '';
            history.forEach(msg => {
                if (deletedMessageIds.has(msg.id)) return;

                const entry = document.createElement('div');
                entry.className = `conversation-entry ${msg.is_client_message ? 'from-client' : 'from-assistant'}`;
                
                const metaDiv = document.createElement('div');
                metaDiv.className = 'meta';
                metaDiv.innerHTML = `
                        <span>${msg.is_client_message ? 'Cliente' : 'Equipe'}</span>
                        <span>${formatTimestamp(msg.timestamp)}</span>
                `;

                // Botão de apagar mensagem individual
                const deleteBtn = document.createElement('span');
                deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
                deleteBtn.className = 'delete-msg';
                deleteBtn.title = 'Apagar mensagem';
                deleteBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (!confirm('Apagar esta mensagem?')) return;
                    try {
                        const response = await fetch(`${apiEndpoint}?action=delete-message`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ messageId: msg.id })
                        });
                        if (!response.ok) {
                            alert('Erro ao apagar mensagem.');
                            return;
                        }
                        deletedMessageIds.add(msg.id);
                        entry.remove();
                        currentConversationMessages = currentConversationMessages.filter(item => item.id !== msg.id);
                        await refreshClientList();
                    } catch (error) {
                        console.error('Error deleting message:', error);
                        alert('Erro ao apagar mensagem.');
                    }
                };
                metaDiv.appendChild(deleteBtn);

                const bodyDiv = document.createElement('div');
                bodyDiv.className = 'body';
                bodyDiv.innerHTML = escapeHTML(msg.message);

                entry.appendChild(metaDiv);
                entry.appendChild(bodyDiv);
                conversationHistory.appendChild(entry);
            });
            conversationHistory.scrollTop = conversationHistory.scrollHeight;
        } catch (error) {
            console.error('Erro ao carregar conversa:', error);
            conversationHistory.innerHTML = '<p>Erro ao carregar conversa.</p>';
        }
    }

    function openConversation({ clientId, clientName, clientLocation, clientPhone, messageId }) {
        currentClientId = clientId;
        conversationTitle.textContent = clientName ? `Conversa com ${clientName}` : 'Conversa do cliente';
        const metaParts = [];
        if (clientLocation) metaParts.push(clientLocation);
        if (clientPhone) metaParts.push(clientPhone);
        conversationMeta.textContent = metaParts.length ? metaParts.join(' - ') : 'Dados nao informados';
        modal.style.display = 'block';
        loadConversation(clientId);
        const row = Array.from(document.querySelectorAll('tr')).find(r => r.dataset && r.dataset.messageId === messageId);
        markRowAsRead(messageId, row);
    }

    clearHistoryBtn.addEventListener('click', async () => {
        if (!currentClientId) return;
        if (!confirm('Tem certeza que deseja limpar todo o historico deste cliente?')) return;
        try {
            const response = await fetch(`${apiEndpoint}?action=delete-client-messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ clientId: currentClientId })
            });
            if (!response.ok) {
                alert('Erro ao apagar historico.');
                return;
            }
            currentConversationMessages.forEach(msg => deletedMessageIds.add(msg.id));
            currentConversationMessages = [];
            conversationHistory.innerHTML = '<p>Nenhuma mensagem registrada para este cliente.</p>';
            await refreshClientList();
        } catch (error) {
            console.error('Error deleting client messages:', error);
            alert('Erro ao apagar historico.');
        }
    });

    globalClearBtn.addEventListener('click', async () => {
        if (!confirm('Tem certeza que deseja apagar TODOS os chats da lista?')) return;
        try {
            const response = await fetch(`${apiEndpoint}?action=delete-all-messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });
            if (!response.ok) {
                alert('Erro ao apagar todos os chats.');
                return;
            }
            allClientMessages.forEach(msg => deletedMessageIds.add(msg.id));
            allClientMessages = [];
            displayMessages(allClientMessages);
            currentConversationMessages = [];
            conversationHistory.innerHTML = '<p>Nenhuma mensagem registrada para este cliente.</p>';
        } catch (error) {
            console.error('Error deleting all messages:', error);
            alert('Erro ao apagar todos os chats.');
        }
    });

    if(closeModal) {
        closeModal.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target == modal) {
            modal.style.display = 'none';
        }
    });

    if(sendResponseBtn) {
        sendResponseBtn.addEventListener('click', async () => {
            const responseMessage = responseText.value.trim();
            if (responseMessage === '') return;
    
            try {
                const response = await fetch(`${apiEndpoint}?action=send-lawyer-message`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message: responseMessage, clientId: currentClientId })
                });

                if (response.ok) {
                    alert('Resposta enviada com sucesso!');
                    responseText.value = '';
                    if (currentClientId) {
                        loadConversation(currentClientId);
                    }
                } else {
                    alert('Erro ao enviar resposta.');
                }
            } catch (error) {
                console.error('Error sending response:', error);
                alert('Erro ao enviar resposta.');
            }
        });
    }
});

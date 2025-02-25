import express from 'express';
import http from 'http';
import ip from 'ip';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';


const app = express();
const server = http.createServer(app);
const PORT = 3000;
const io = new Server(server, {
    cors: {
        origin: '*',
    }
});

app.use(cors(
    {
        origin: '*',
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
        allowedHeaders: ['Content-Type', 'Authorization']
    }
));
app.use(express.json());

const secretKey = "supersecretkey"; // Clé secrète pour le token admin
let adminSocketId = null; // ID du contrôleur admin
const robots = new Map(); // robotId -> socket.id des robots connectés
const controllers = new Map(); // robotId -> socket.id des contrôleurs assignés
const viewers = new Map();

// Vérifie si un socket est l'admin
function isAdmin(socket) {
    return socket.id === adminSocketId;
}

app.post('/admin/auth', (req, res) => {
    const { password, socketId } = req.body;
    const adminPassword = "supersecret"; // Mot de passe de l'admin

    if (password === adminPassword) {
        const token = jwt.sign({ role: 'admin' }, secretKey, { expiresIn: '1y' });
        
        // Définir l'admin socket ID s'il est fourni
        if (socketId) {
            adminSocketId = socketId;
            console.log(`🛠️ Admin connecté avec le socket ID : ${adminSocketId}`);
        }

        return res.json({ token });
    } else {
        return res.status(401).json({ error: 'Mot de passe incorrect' });
    }
});

// Middleware pour sécuriser les routes admin
function authenticateAdmin(req, res, next) {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ error: 'Token requis' });
    }

    jwt.verify(token, secretKey, (err, decoded) => {
        if (err || decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Accès refusé, admin requis' });
        }
        next();
    });
}

// 🔍 Obtenir la liste des robots connectés avec leur statut
app.get('/robots', (req, res) => {
    const robotList = Array.from(robots.keys()).map(robotId => ({
        robotId,
        status: controllers.has(robotId) ? 'occupé' : 'disponible'
    }));
    return res.json(robotList);
});

// 🌐 Route de base
app.get('/', (req, res) => {
    res.json('ip address: http://' + ip.address() + ':' + PORT);
});

app.get('/reset', (req, res) => {
    robots.clear();
    controllers.clear();
    viewers.clear();
    adminSocketId = null;
    res.json({ message: 'Serveur réinitialisé' });
})

setInterval(() => {
    console.log("🔍 Vérification des robots connectés...");
    
    for (const [robotId, socketId] of robots.entries()) {
        if (!socketId || !io.sockets.sockets.has(socketId)) {
            console.log(`❌ Robot ${robotId} semble déconnecté.`);
            // change status dans robots et notifie tout le monde
            robots.set(robotId, null);

            io.emit('statusChange', { robotId, status: 'hors ligne' });
        }
    }
}, 10000);

// 🚦 Gestion des connexions Socket.IO
io.on('connection', (socket) => {
    console.log('Un client est connecté: ' + socket.id);

    // Enregistrer un robot et notifier tous les clients
    // Gestion de l'enregistrement des robots
    socket.on('register', (robotId) => {
        if (robots.has(robotId)) {
            const existingSocketId = robots.get(robotId);
            
            if (existingSocketId) {
                // 🔴 Si un robot avec ce même ID est déjà connecté, on refuse
                console.log(`❌ Erreur : Un robot avec l'ID ${robotId} est déjà en ligne.`);
                socket.emit('registerError', { error: `Un robot avec l'ID ${robotId} est déjà connecté.` });
                return;
            }
    
            // 🔄 Si le robot était hors ligne, on le reconnecte
            console.log(`🔄 Robot ${robotId} reconnecté.`);
        } else {
            console.log(`✅ Nouveau robot ${robotId} enregistré.`);
        }
        
        robots.set(robotId, socket.id); // Mise à jour du socket ID
        io.emit('robotConnected', { robotId, status: controllers.has(robotId) ? 'occupé' : 'disponible' });
    });
    
    socket.on('subscribeVideo', (robotId) => {
        if (!robots.has(robotId)) {
            socket.emit('error', { message: `Le robot ${robotId} n'est pas connecté.` });
            return;
        }

        if (!viewers.has(robotId)) {
            viewers.set(robotId, new Set());
        }
        viewers.get(robotId).add(socket.id);
        console.log(`👀 ${socket.id} s'est abonné au flux du robot ${robotId}`);
    });

    socket.on('unsubscribeVideo', (robotId) => {
        if (viewers.has(robotId)) {
            viewers.get(robotId).delete(socket.id);
            console.log(`🚫 ${socket.id} s'est désabonné du flux du robot ${robotId}`);
        }
    });

    socket.on('image', ({ robot_id, image }) => {
        //console.log(`📷 Image reçue du robot ${robot_id}`);
        if (!robots.has(robot_id)) return;

        const controllerId = controllers.get(robot_id);
        const robotViewers = viewers.get(robot_id) || new Set();

        // Envoyer l'image au contrôleur (s'il y en a un)
        if (controllerId) {
            io.to(controllerId).emit('image', { robot_id, image });
        }

        // Envoyer l'image aux viewers abonnés
        robotViewers.forEach(viewerId => {
            io.to(viewerId).emit('image', { robot_id, image });
           // console.log(`📡 Image du robot ${robot_id} envoyée à ${viewerId}`);
        });

        //console.log(`📡 Flux vidéo du robot ${robot_id} envoyé aux abonnés.`);
    }); 

    // Demande pour devenir contrôleur d'un robot
    socket.on('becomeController', (robotId) => {
        console.log(robots)
        console.log(robotId)
        if (!robots.has(robotId)) {
            console.log(`Le robot ${robotId} n'est pas connecté.`);
            socket.emit('controllerError', { error: `Le robot ${robotId} n'est pas connecté.` });
            return;
        }
    
        if (controllers.has(robotId)) {
            console.log(`Le robot ${robotId} a déjà un contrôleur.`);
            socket.emit('controllerError', { error: `Le robot ${robotId} est déjà contrôlé.` });
            return;
        }
    
        controllers.set(robotId, socket.id);
        console.log(`${socket.id} devient le contrôleur de ${robotId}`);
        socket.emit('controllerSuccess', { robotId });
        // prevenir tout le monde que le robot est controlé
        io.emit('statusChange', { robotId, status: 'occupé' });
    });

    socket.on('releaseControl', (robotId) => {
        console.log(`${socket.id} relâche le contrôle de ${robotId}`);
        if (controllers.has(robotId) && controllers.get(robotId) === socket.id) {
            console.log(`${socket.id} relâche le contrôle de ${robotId}`);
            controllers.delete(robotId);
            socket.emit('releaseSuccess', { robotId });
            io.emit('statusChange', { robotId, status: 'disponible' });
        } else {
            console.log(`${socket.id} ne peut pas relâcher le contrôle de ${robotId}`);
            socket.emit('releaseError', { error: `Vous ne contrôlez pas le robot ${robotId}.` });
        }
    });

    // 🔥 Prise de contrôle par l'admin avec déconnexion du contrôleur précédent
    socket.on('command', ({ robotId, msg }) => {
        console.log(`Commande reçue pour le robot ${robotId}: ${msg}`);
        // Vérifier si le robot est bien connecté
        if (!robots.has(robotId)) {
            console.log(`❌ Commande refusée : Le robot ${robotId} n'est pas connecté.`);
            socket.emit('commandError', { error: `Le robot ${robotId} n'est pas connecté.` });
            return;
        }
    
        const controllerId = controllers.get(robotId);
    
        // Vérifier si le socket actuel est bien le contrôleur
        if (socket.id === controllerId || isAdmin(socket)) {
            if (isAdmin(socket) && controllerId !== socket.id) {
                // Déconnecter l'ancien contrôleur
                const previousControllerSocket = io.sockets.sockets.get(controllerId);
                if (previousControllerSocket) {
                    previousControllerSocket.emit('controlTakenByAdmin', { robotId });
                    console.log(`⚠️ L'admin a pris le contrôle du robot ${robotId}.`);
                }
                controllers.set(robotId, socket.id);
            }
    
            // Envoyer la commande au robot
            const targetSocketId = robots.get(robotId);
            if (targetSocketId) {
                io.to(targetSocketId).emit('command', msg);
                console.log(`✅ Commande envoyée au robot ${robotId}: ${msg}`);
            } else {
                console.log(`❌ Impossible d'envoyer la commande, le robot ${robotId} est introuvable.`);
            }
        } else {
            console.log(`❌ Commande refusée : ${socket.id} n'est pas le contrôleur de ${robotId}.`);
            socket.emit('commandError', { error: `Vous n'êtes pas le contrôleur du robot ${robotId}.` });
        }
    });

    socket.on('reconnectRobot', (robotId) => {
        if (robots.has(robotId) && robots.get(robotId) === null) {
            robots.set(robotId, socket.id);
            console.log(`✅ Robot ${robotId} re-connecté.`);
            io.emit('robotConnected', { robotId, status: controllers.has(robotId) ? 'occupé' : 'disponible' });
        } else {
            console.log(`❌ Impossible de reconnecter le robot ${robotId}, il n'était pas enregistré.`);
            socket.emit('reconnectError', { error: `Le robot ${robotId} n'était pas connu du serveur.` });
        }
    });
    

    // 📴 Gérer les déconnexions de robots et contrôleurs
    socket.on('disconnect', () => {
        console.log(`🔌 Déconnexion de ${socket.id}`);
    
        // 🔍 Vérifier si c'est un robot qui se déconnecte
        for (const [robotId, socketId] of robots.entries()) {
            if (socketId === socket.id) {
                // 🛑 Marquer le robot comme hors ligne mais NE PAS l'effacer
                robots.set(robotId, null);
                console.log(`🚨 Robot ${robotId} est hors ligne mais conservé en mémoire.`);
                
                // 🔔 Notifier le contrôleur s'il y en a un
                if (controllers.has(robotId)) {
                    const controllerId = controllers.get(robotId);
                    io.to(controllerId).emit('robotDecoCtrl', { robotId });
                    console.log(`🔴 Notification envoyée au contrôleur ${controllerId} : Robot ${robotId} déconnecté.`);
                }
    
                // 📡 Notifier tous les viewers
                if (viewers.has(robotId)) {
                    viewers.get(robotId).forEach(viewerId => {
                        io.to(viewerId).emit('robotDeco', { robotId });
                        console.log(`👀 Viewer ${viewerId} informé que le robot ${robotId} est hors ligne.`);
                    });
                }
    
                // 🛰️ Mettre à jour l'état sur la carte
                io.emit('statusChange', { robotId, status: 'hors ligne' });
                break;
            }
        }
    
        // 🔍 Vérifier si c'est un contrôleur qui se déconnecte
        for (const [robotId, controllerId] of controllers.entries()) {
            if (controllerId === socket.id) {
                controllers.delete(robotId);
                console.log(`🎮 Le contrôleur de ${robotId} s'est déconnecté.`);
                io.emit('statusChange', { robotId, status: 'disponible' });
                break;
            }
        }
    
        // 🔍 Vérifier si c'est un viewer qui se déconnecte
        for (const [robotId, viewerSet] of viewers.entries()) {
            if (viewerSet.has(socket.id)) {
                viewerSet.delete(socket.id);
                console.log(`👀 Viewer ${socket.id} s'est désabonné du flux du robot ${robotId}`);
            }
        }
    });    
});

server.listen(PORT, () => {
    console.log(`Serveur lancé sur : http://${ip.address()}:${PORT}`);
});

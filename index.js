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

// 🚦 Gestion des connexions Socket.IO
io.on('connection', (socket) => {
    console.log('Un client est connecté: ' + socket.id);

    // Enregistrer un robot et notifier tous les clients
    // Gestion de l'enregistrement des robots
    socket.on('register', (robotId) => {
        if (robots.has(robotId)) {
            console.log(`❌ Échec : Un robot avec l'ID ${robotId} est déjà connecté.`);
            socket.emit('registerError', { error: `Un robot avec l'ID ${robotId} est déjà connecté.` });
            return;
        }

        robots.set(robotId, socket.id);
        console.log(`✅ Robot ${robotId} connecté.`);
        io.emit('robotConnected', { robotId, status: controllers.has(robotId) ? 'occupé' : 'disponible' });
    });socket.on('subscribeVideo', (robotId) => {
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
        console.log(`📷 Image reçue du robot ${robot_id}`);
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
            console.log(`📡 Image du robot ${robot_id} envoyée à ${viewerId}`);
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
    

    // 📴 Gérer les déconnexions de robots et contrôleurs
    socket.on('disconnect', () => {
        console.log(`Déconnexion de ${socket.id}`);
        if (socket.id === adminSocketId) {
            console.log('🛠️ L\'admin s\'est déconnecté.');
            adminSocketId = null;
            io.emit('adminDisconnected');
        }
        // Gérer la déconnexion d'un robot
        for (const [robotId, socketId] of robots.entries()) {
            if (socketId === socket.id) {
                robots.delete(robotId);
    
                // 🔥 Vérifier si un contrôleur est assigné
                if (controllers.has(robotId)) {
                    const controllerId = controllers.get(robotId);
                    io.to(controllerId).emit('robotDeco', { robotId });
                    console.log(`🚨 Notification envoyée au contrôleur ${controllerId} : Robot ${robotId} déconnecté.`);
                    controllers.delete(robotId); // Libérer le contrôleur
                }
                if (viewers.has(robotId)) {
                    viewers.delete(robotId);
                    console.log(`👥 Tous les abonnés du robot ${robotId} ont été retirés.`);
                }
    
                console.log(`Robot ${robotId} déconnecté.`);
                io.emit('robotDisconnected', { robotId });
                break;
            }
        }
    
        // Gérer la déconnexion d'un contrôleur
        for (const [robotId, controllerId] of controllers.entries()) {
            if (controllerId === socket.id) {
                controllers.delete(robotId);
                console.log(`Le contrôleur de ${robotId} s'est déconnecté.`);
                io.emit('statusChange', { robotId, status: 'disponible' });
                break;
            }
        } 
        for (const [robotId, viewerSet] of viewers.entries()) {
            if (viewerSet.has(socket.id)) {
                viewerSet.delete(socket.id);
                console.log(`🚪 ${socket.id} s'est désabonné du flux du robot ${robotId}`);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Serveur lancé sur : http://${ip.address()}:${PORT}`);
});

import express from 'express';
import http from 'http';
import ip from 'ip';
import { Server } from 'socket.io';
import cors from 'cors';
const app = express();
const server = http.createServer(app);
const PORT = 3000;
const io = new Server(server, {
    cors: {
        origin: '*',
        }
})
app.use(cors())
app.get('/', (req, res) => {
    res.json('ip address: http://' + ip.address()+':'+PORT);    
});

io.on('connection', (socket) => {
    console.log('a user connected');
    socket.broadcast.emit('user connected');
    socket.on('disconnect', () => {
        console.log('user disconnected');
        socket.broadcast.emit('user disconnected');
    });
    socket.on('image', (data) => {
        console.log('Image reçue et transmise aux clients.');
        io.emit('stream', data.image);
    });
    socket.on('message', (msg) => {
        console.log('message: ' + msg);
        io.emit('message', msg);
    });
    socket.on('vitesse', (msg) => {
        console.log('vitesse: ' + msg)
        io.emit('vitesse', msg);
    });
    socket.on('commandeMotor', (msg) => {
        console.log('cmd motor: ' + msg)
        io.emit('commandeMotor', msg);
    });
    socket.on('ctrlCam', (cmd) => {
        console.log(`Camera control command received: ${cmd}`);
        if (cmd === 'pause' || cmd === 'resume') {
            io.emit('ctrlCam', cmd);
        } else {
            console.error(`Invalid camera control command: ${cmd}`);
        }
    });
    socket.on('changeLed', (data) => {
        console.log('Commande LED reçue :', data);
        io.emit('changeLed', data);
    });
    socket.on('playSound', (data) => {
        console.log('Commande Son reçue :', data);
        io.emit('playSound', data);
    });
})
server.listen(PORT, () => {
    console.log('Server ip : http://' +ip.address() +":" + PORT);
})
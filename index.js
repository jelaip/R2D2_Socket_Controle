import express from 'express';
import http from 'http';
import ip from 'ip';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { stat } from 'fs';


const app = express();
const server = http.createServer(app);
const PORT = 3000;

let listRooms = [];

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
app.get('/', (req, res) => res.json('ip address: http://' + ip.address() + ':' + PORT));
app.get('/robots', (req, res) => res.json(listRooms));
app.get('/reset', (req, res) => {
    listRooms.forEach(room => room.controlleur = null);
    res.json(listRooms);
});

io.on('connection', (socket) => {
    console.log('Un client est connecté: ' + socket.id);
    socket.on('register', (robotId) => {
        //create room with data name
        console.log("register " + robotId);
        let room = {
            name: robotId,
            status: "connected",
            controlleur: null,
            users: []
        }
        //if room not exist
        if(!listRooms.find(room => room.name === robotId))listRooms.push(room);
        socket.join(robotId);
        //socket.emit('register', room);
        io.emit('robotConnected', room);
    })
    socket.on('join', (data) => {
        let room = listRooms.find(room => room.name === data.room);
        if(room){
            socket.join(data.room);
            console.log("join " + data.name + " " + data.room);
            if(room.users.includes(data.name)){
                let removeUser = room.users.find(user => user.name === data.name);
                io.to(removeUser.id).emit('leave', room.name);
                room.users = room.users.filter(user => user !== data.name);
            }
            let user = {
                id: socket.id,
                name: data.name
            }
            room.users.push(user);
            io.to(socket.id).emit('join', room.name);
        }
    })
    socket.on('leave', (data) => {
        console.log("leave " + data)
        let room = listRooms.find(room => room.name === data.room);
        if(room){
            //if user is a controller, release control
            if(room.controlleur === data.name){
                room.controlleur = null;
                io.to(data.room).emit("releaseSuccess", room);
            }
            socket.leave(data.room);
            room.users = room.users.filter(user => user !== socket.id);
            io.to(socket.id).emit('leave', room.name);
        }
    })

    socket.on('image', (data) => {
        //console.log("image " + data.robot_id);
        io.to(data.robot_id).emit('image', data.image);
    })
    socket.on('disconnect', () => {
        console.log('Un client est déconnecté: ' + socket.id);
        //remove user from room
        listRooms.forEach(room => {
            room.users = room.users.filter(user => user !== socket.id);
        })
    })
    socket.on('becomeController', (data) => { //room name
        //if id socket is in room and controlleur is null
        console.log("becomeController " + data.name + " " + data.room);
        let room = listRooms.find(room => room.name === data.room);
        console.log("usercount " + room.users.length);
        for(let i = 0; i < room.users.length; i++)console.log(room.users[i].name);
            
        if(room && room.controlleur === null && room.users.find(user => user.name === data.name)){
            room.controlleur = data.name;
            console.log(data.name + " is now controller of " + data.room);
            io.to(data.room).emit('becomeController', room.name);
            socket.emit('controllerSuccess', room.name);
            return;
        }
        if(room && room.controlleur == data.name){
            socket.emit('controllerSuccess', room.name);
        }
    })
    socket.on('releaseControl', (data) => { //room, name
        console.log("releaseControl" + data);
        let room = listRooms.find(room => room.name === data.room);
        if(room && room.controlleur === data.name){
            room.controlleur = null;
            io.to(data.room).emit("releaseSuccess", room);
        }
    })
    socket.on('command', (data) => {
        //if controlleur is socket.id
        console.log("command " + data);
        let room = listRooms.find(room => room.name === data.room);
        //console.log("room " + room.name + " " + room.controlleur + " " + data.name);
        if(room && room.controlleur === data.name){
            console.log("command emit " + data.room + " " + data.command);
            io.to(data.room).emit('command', data.command);
        }
    })
});

server.listen(PORT, () => {
    console.log(`Serveur lancé sur : http://${ip.address()}:${PORT}`);
});



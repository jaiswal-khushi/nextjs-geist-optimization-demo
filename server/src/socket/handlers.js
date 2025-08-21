const Message = require('../models/Message');
const User = require('../models/User');
const { socketAuth } = require('../middleware/auth');

// Store active socket connections
const activeUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId

const setupSocketHandlers = (io) => {
  // Socket authentication middleware
  io.use(socketAuth);

  io.on('connection', async (socket) => {
    try {
      const userId = socket.userId;
      console.log(`User ${socket.user.username} connected with socket ${socket.id}`);

      // Store user connection
      activeUsers.set(userId, socket.id);
      userSockets.set(socket.id, userId);

      // Update user online status
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastSeen: new Date()
      });

      // Notify other users that this user is online
      socket.broadcast.emit('user:online', {
        userId,
        username: socket.user.username
      });

      // Handle sending messages
      socket.on('message:send', async (data) => {
        try {
          const { receiverId, text } = data;

          // Validation
          if (!receiverId || !text || text.trim().length === 0) {
            socket.emit('error', { message: 'Invalid message data' });
            return;
          }

          // Check if receiver exists
          const receiver = await User.findById(receiverId);
          if (!receiver) {
            socket.emit('error', { message: 'Receiver not found' });
            return;
          }

          // Create and save message
          const message = new Message({
            sender: userId,
            receiver: receiverId,
            text: text.trim()
          });

          await message.save();
          await message.populate('sender', 'username');
          await message.populate('receiver', 'username');

          const messageData = {
            id: message._id,
            text: message.text,
            sender: {
              id: message.sender._id,
              username: message.sender.username
            },
            receiver: {
              id: message.receiver._id,
              username: message.receiver.username
            },
            delivered: message.delivered,
            read: message.read,
            createdAt: message.createdAt
          };

          // Send to receiver if online
          const receiverSocketId = activeUsers.get(receiverId);
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('message:new', {
              ...messageData,
              isFromMe: false
            });

            // Mark as delivered immediately if receiver is online
            message.delivered = true;
            message.deliveredAt = new Date();
            await message.save();
          }

          // Confirm to sender
          socket.emit('message:sent', {
            ...messageData,
            isFromMe: true,
            delivered: message.delivered
          });

          console.log(`Message sent from ${socket.user.username} to ${receiver.username}`);

        } catch (error) {
          console.error('Message send error:', error);
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // Handle typing indicators
      socket.on('typing:start', (data) => {
        try {
          const { receiverId } = data;
          const receiverSocketId = activeUsers.get(receiverId);
          
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('typing:start', {
              userId,
              username: socket.user.username
            });
          }
        } catch (error) {
          console.error('Typing start error:', error);
        }
      });

      socket.on('typing:stop', (data) => {
        try {
          const { receiverId } = data;
          const receiverSocketId = activeUsers.get(receiverId);
          
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('typing:stop', {
              userId,
              username: socket.user.username
            });
          }
        } catch (error) {
          console.error('Typing stop error:', error);
        }
      });

      // Handle message read receipts
      socket.on('message:read', async (data) => {
        try {
          const { messageId, senderId } = data;

          // Update message as read
          const message = await Message.findByIdAndUpdate(
            messageId,
            { 
              read: true, 
              readAt: new Date() 
            },
            { new: true }
          );

          if (message) {
            // Notify sender if online
            const senderSocketId = activeUsers.get(senderId);
            if (senderSocketId) {
              io.to(senderSocketId).emit('message:read', {
                messageId,
                readBy: userId,
                readAt: message.readAt
              });
            }
          }

        } catch (error) {
          console.error('Message read error:', error);
        }
      });

      // Handle conversation read (mark all messages as read)
      socket.on('conversation:read', async (data) => {
        try {
          const { senderId } = data;

          // Mark all messages from sender as read
          await Message.markAsRead(senderId, userId);

          // Notify sender if online
          const senderSocketId = activeUsers.get(senderId);
          if (senderSocketId) {
            io.to(senderSocketId).emit('conversation:read', {
              readBy: userId,
              readAt: new Date()
            });
          }

        } catch (error) {
          console.error('Conversation read error:', error);
        }
      });

      // Handle user status updates
      socket.on('status:update', async (data) => {
        try {
          const { isOnline } = data;
          
          await User.findByIdAndUpdate(userId, {
            isOnline: isOnline !== undefined ? isOnline : true,
            lastSeen: new Date()
          });

          // Broadcast status update
          socket.broadcast.emit('user:status', {
            userId,
            isOnline: isOnline !== undefined ? isOnline : true,
            lastSeen: new Date()
          });

        } catch (error) {
          console.error('Status update error:', error);
        }
      });

      // Handle disconnect
      socket.on('disconnect', async () => {
        try {
          console.log(`User ${socket.user.username} disconnected`);

          // Remove from active users
          activeUsers.delete(userId);
          userSockets.delete(socket.id);

          // Update user offline status
          await User.findByIdAndUpdate(userId, {
            isOnline: false,
            lastSeen: new Date()
          });

          // Notify other users that this user is offline
          socket.broadcast.emit('user:offline', {
            userId,
            username: socket.user.username,
            lastSeen: new Date()
          });

        } catch (error) {
          console.error('Disconnect error:', error);
        }
      });

    } catch (error) {
      console.error('Socket connection error:', error);
      socket.disconnect();
    }
  });

  // Handle connection errors
  io.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
  });
};

// Helper function to get online users
const getOnlineUsers = () => {
  return Array.from(activeUsers.keys());
};

// Helper function to check if user is online
const isUserOnline = (userId) => {
  return activeUsers.has(userId);
};

module.exports = {
  setupSocketHandlers,
  getOnlineUsers,
  isUserOnline
};

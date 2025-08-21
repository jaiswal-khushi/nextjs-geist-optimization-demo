const express = require('express');
const Message = require('../models/Message');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /conversations/:id/messages
// @desc    Get messages for a conversation
// @access  Private
router.get('/conversations/:id/messages', auth, async (req, res) => {
  try {
    const { id: otherUserId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Validate other user exists
    const otherUser = await User.findById(otherUserId);
    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get messages for the conversation
    const messages = await Message.getConversation(
      req.user._id,
      otherUserId,
      parseInt(page),
      parseInt(limit)
    );

    // Mark messages from other user as delivered
    await Message.markAsDelivered(otherUserId, req.user._id);

    // Format messages for response
    const formattedMessages = messages.reverse().map(message => ({
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
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      isFromMe: message.sender._id.toString() === req.user._id.toString()
    }));

    res.json({
      success: true,
      data: {
        messages: formattedMessages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: messages.length === parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get messages error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error while fetching messages'
    });
  }
});

// @route   POST /messages
// @desc    Send a new message
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { receiverId, text } = req.body;

    // Validation
    if (!receiverId || !text) {
      return res.status(400).json({
        success: false,
        message: 'Receiver ID and message text are required'
      });
    }

    if (text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message text cannot be empty'
      });
    }

    // Validate receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    // Cannot send message to yourself
    if (receiverId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send message to yourself'
      });
    }

    // Create new message
    const message = new Message({
      sender: req.user._id,
      receiver: receiverId,
      text: text.trim()
    });

    await message.save();

    // Populate sender and receiver info
    await message.populate('sender', 'username');
    await message.populate('receiver', 'username');

    const formattedMessage = {
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
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      isFromMe: true
    };

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        message: formattedMessage
      }
    });

  } catch (error) {
    console.error('Send message error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid receiver ID'
      });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error while sending message'
    });
  }
});

// @route   PUT /messages/:id/read
// @desc    Mark message as read
// @access  Private
router.put('/:id/read', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Only receiver can mark message as read
    if (message.receiver.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to mark this message as read'
      });
    }

    // Update message
    message.read = true;
    message.readAt = new Date();
    await message.save();

    res.json({
      success: true,
      message: 'Message marked as read',
      data: {
        messageId: message._id,
        read: message.read,
        readAt: message.readAt
      }
    });

  } catch (error) {
    console.error('Mark as read error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error while marking message as read'
    });
  }
});

// @route   PUT /conversations/:id/read
// @desc    Mark all messages in conversation as read
// @access  Private
router.put('/conversations/:id/read', auth, async (req, res) => {
  try {
    const { id: senderId } = req.params;

    // Validate sender exists
    const sender = await User.findById(senderId);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Mark all unread messages from sender as read
    const result = await Message.markAsRead(senderId, req.user._id);

    res.json({
      success: true,
      message: 'Messages marked as read',
      data: {
        modifiedCount: result.modifiedCount
      }
    });

  } catch (error) {
    console.error('Mark conversation as read error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error while marking messages as read'
    });
  }
});

module.exports = router;

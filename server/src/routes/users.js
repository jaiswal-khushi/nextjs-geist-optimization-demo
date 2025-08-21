const express = require('express');
const User = require('../models/User');
const Message = require('../models/Message');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /users
// @desc    Get all users except current user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const users = await User.find({ 
      _id: { $ne: req.user._id } 
    }).select('-password').sort({ username: 1 });

    // Get last message for each user
    const usersWithLastMessage = await Promise.all(
      users.map(async (user) => {
        const lastMessage = await Message.findOne({
          $or: [
            { sender: req.user._id, receiver: user._id },
            { sender: user._id, receiver: req.user._id }
          ]
        })
        .sort({ createdAt: -1 })
        .populate('sender', 'username')
        .populate('receiver', 'username');

        return {
          id: user._id,
          username: user.username,
          email: user.email,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen,
          lastMessage: lastMessage ? {
            text: lastMessage.text,
            createdAt: lastMessage.createdAt,
            sender: lastMessage.sender.username,
            isFromMe: lastMessage.sender._id.toString() === req.user._id.toString()
          } : null
        };
      })
    );

    res.json({
      success: true,
      data: {
        users: usersWithLastMessage
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
});

// @route   GET /users/:id
// @desc    Get user by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get unread message count from this user
    const unreadCount = await Message.countDocuments({
      sender: req.params.id,
      receiver: req.user._id,
      read: false
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen,
          unreadCount
        }
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error while fetching user'
    });
  }
});

// @route   PUT /users/status
// @desc    Update user online status
// @access  Private
router.put('/status', auth, async (req, res) => {
  try {
    const { isOnline } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { 
        isOnline: isOnline !== undefined ? isOnline : true,
        lastSeen: new Date()
      },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: {
        user: {
          id: user._id,
          username: user.username,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen
        }
      }
    });

  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating status'
    });
  }
});

module.exports = router;

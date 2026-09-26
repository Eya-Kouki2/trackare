const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const { isMongoConnectionError, mongoConnectionMessage } = require('../utils/mongoError');

const verifyToken = async (req, res, next) => {

    let token = req.cookies.token;

    // Also support Authorization: Bearer <token> header for multi-session / API testing
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized - no token provided'
        });
    };

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (!decoded) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized - invalid token'
            });
        };

        const user = await User.findById(decoded.userID).select('role areaId');
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized - user not found'
            });
        }

        req.userID = decoded.userID;
        req.userRole = user.role;
        req.userAreaId = user.areaId;
        
        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized - invalid or expired token',
            });
        }

        if (isMongoConnectionError(error)) {
            console.error('Error in verifyToken (database):', error.message);
            return res.status(503).json({
                success: false,
                message: mongoConnectionMessage,
            });
        }

        console.error('Error in verifyToken', error);
        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

module.exports = verifyToken;
const User = require('../models/userModel')
const Area = require('../models/areaModel')
const bcryptjs = require('bcryptjs');
const cloudinary = require('../config/cloudinary');
const generateTokenAndSetCookie  = require('../utils/generateTokenAndSetCookie');
const {
    sendVerificationEmail, 
    sendWelcomeEmail, 
    sendResetPasswordEmail,
    sendResetSuccessEmail
} = require('../mailer/emails');
const { isMongoConnectionError, mongoConnectionMessage } = require('../utils/mongoError');

const VALID_ROLES = ['admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'];

const formatUserResponse = async (user) => {
    const area = user.areaId ? await Area.findById(user.areaId) : null;
    return {
        ...user._doc,
        password: undefined,
        area: area ? { _id: area._id, name: area.name, code: area.code, address: area.address } : null,
    };
};

const signup = async (req, res) => {

    const {email, password, name, role, areaCode} = req.body;

    try{
        if(!email || !password || !name || !role)
        {
            throw new Error('All fields are required');
        };

        if (!VALID_ROLES.includes(role)) {
            throw new Error('Invalid role selected');
        }

        let areaId = null;

        if (role === 'admin') {
            if (areaCode) {
                throw new Error('Admins do not need an area code');
            }
        } else {
            if (!areaCode) {
                throw new Error('Area code is required for staff accounts');
            }

            const area = await Area.findOne({
                code: areaCode.trim().toUpperCase(),
                isActive: true,
            });

            if (!area) {
                return res.status(400).json({
                    success: false,
                    message: 'This area code does not exist. Please check with your admin.',
                });
            }

            areaId = area._id;
        }

        const userAlreadyExists = await User.findOne({
            email
        });

        const userNotVerified = await User.findOne({
            email,
            isVerified: false
        });

        if (userAlreadyExists && userNotVerified) 
        {
            return res.status(400).json({
                success: false, 
                message: 'User not verified yet'
            });
        }


        if(userAlreadyExists)
        {
            return res.status(400).json({
                success: false, 
                message: 'User already exists'
            });
        };

        const hashedPassword = await bcryptjs.hash(password, 10);

        const verificationToken = Math.floor(Math.random() * 900000 + 100000).toString();

        const user = new User({
            email, 
            password: hashedPassword, 
            name,
            role,
            areaId,
            verificationToken,
            verificationTokenExpiresAt: Date.now() + 24 * 60 * 60 * 1000
        });

        await user.save();

        generateTokenAndSetCookie(res, user._id);

        try {
            await sendVerificationEmail(user.email, verificationToken);
        } catch (emailError) {
            await User.findByIdAndDelete(user._id);
            res.clearCookie('token');
            throw emailError;
        }

        res.status(201).json({
            success: true, 
            message: 'User created successfully',
            user: await formatUserResponse(user)
        });

    }catch(error)
    {
        return res.status(400).json({
            success: false, 
            message: error.message
        });
    };
};

const verifyEmail = async (req, res) => {
    const { code } = req.body;

    try {
        const user = await User.findOne({
            verificationToken: code,
            verificationTokenExpiresAt: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid or expired verification code' 
            });
        };

        user.isVerified = true;
        user.verificationToken = undefined;
        user.verificationTokenExpiresAt = undefined;

        await user.save();

        try {
            await sendWelcomeEmail(user.email, user.name);
        } catch (error) {
            console.error('Failed to send welcome email:', error.message);
        }

        res.status(200).json({
            success: true,
            message: 'Email verified successfully',
            user: await formatUserResponse(user),
        });
    } catch (error) {
        console.error('Error in verifyEmail', error.message);
        res.status(500).json({
            success: false,
            message: 'Server error' 
        });
    };
};

const resendVerificationEmail = async (req, res) => {
    const { email } = req.body;

    try {
        if (!email) {
            throw new Error('Email is required');
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        if (user.isVerified) {
            return res.status(400).json({
                success: false,
                message: 'User is already verified',
            });
        }

        // Generate a new verification token
        const newVerificationToken = Math.floor(Math.random() * 900000 + 100000).toString();
        user.verificationToken = newVerificationToken;
        user.verificationTokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

        await user.save();

        // Resend the verification email
        await sendVerificationEmail(user.email, newVerificationToken);

        res.status(200).json({
            success: true,
            message: 'Verification email resent successfully',
        });
    } catch (error) {
        console.error('Error in resendVerificationEmail:', error.message);
        res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};


const login = async (req, res) => {

    const { email, password } = req.body;
    try {

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid credendials'
            });
        };

        const isPasswordValid = await bcryptjs.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid credendials'
            });
        };

        if (!user.isVerified) {
            user.isVerified = true;
        }

        const token = generateTokenAndSetCookie(res, user._id);

        user.lastLogin = new Date();

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Logged in successfully',
            token,
            user: await formatUserResponse(user)
        });

    } catch (error) {
        console.error('Error in login', error);
        if (isMongoConnectionError(error)) {
            return res.status(503).json({
                success: false,
                message: mongoConnectionMessage,
            });
        }
        res.status(400).json({
            success: false,
            message: error.message
        })
    };
};

const logout = async (req, res) => {
    res.clearCookie('token');
    res.status(200).json({
        success: true,
        message: 'logged out successfully'
    });
};

const forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            })
        };
 
        // Generate 6-digit reset code
        const resetToken = Math.floor(Math.random() * 900000 + 100000).toString();
        const resetTokenExpiresAt = Date.now() + 1 * 60 * 60 * 1000; // 1 hour

        user.resetPasswordToken = resetToken;
        user.resetPasswordExpiresAt = resetTokenExpiresAt;

        await user.save();

        await sendResetPasswordEmail(user.email, resetToken);

        res.status(200).json({
            success: true,
            message: 'Password reset code sent to your email'
        });

    } catch (error) {
        console.log('Error in forgotPassword', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    };
};

const verifyResetCode = async (req, res) => {
    const { email, code } = req.body;

    try {
        if (!email || !code) {
            return res.status(400).json({
                success: false,
                message: 'Email and code are required',
            });
        }

        const user = await User.findOne({
            email,
            resetPasswordToken: code.trim(),
            resetPasswordExpiresAt: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset code',
            });
        }

        res.status(200).json({
            success: true,
            message: 'Code verified',
        });
    } catch (error) {
        console.log('Error in verifyResetCode', error);
        res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const resetPassword = async (req, res) => {

    try {

        const { email, code, password } = req.body;

        if (!email || !code || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email, code, and password are required',
            });
        }

        const user = await User.findOne({
            email,
            resetPasswordToken: code.trim(),
            resetPasswordExpiresAt: {$gt: Date.now()}
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset code'
            });
        };

        // update password
        const hashedPassword = await bcryptjs.hash(password, 10);

        user.password = hashedPassword;

        user.resetPasswordToken = undefined;
        user.resetPasswordExpiresAt = undefined;

        await user.save();

        await sendResetSuccessEmail(user.email);

        res.status(200).json({
            success: true,
            message: 'Password reset successfull'
        });

    } catch (error) {
        console.log('Error in resetPassword', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    };
};

const checkAuth = async (req, res) => {
    try {

        const user = await User.findById(req.userID).select('-password');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        };

        if (!user.isVerified) {
            user.isVerified = true;
            await user.save();
        }

        const area = user.areaId ? await Area.findById(user.areaId) : null;

        res.status(200).json({
            success: true,
            user: {
                ...user._doc,
                area: area ? { _id: area._id, name: area.name, code: area.code, address: area.address } : null,
            }
           
        });

    } catch (error) {
        console.log('Error in checkAuth', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    };
};


const updateProfilePicture = async (req, res) => {
    try {
        const { profilePicture, profilePicturePublicId } = req.body;

        if (!profilePicture || !profilePicturePublicId) {
            return res.status(400).json({
                success: false,
                message: 'Profile picture URL and public ID are required',
            });
        }

        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        if (!cloudName) {
            return res.status(500).json({
                success: false,
                message: 'Cloudinary is not configured on the server',
            });
        }

        const expectedUrlPrefix = `https://res.cloudinary.com/${cloudName}/`;
        if (!profilePicture.startsWith(expectedUrlPrefix)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid profile picture URL',
            });
        }

        const user = await User.findById(req.userID);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        if (user.profilePicturePublicId && user.profilePicturePublicId !== profilePicturePublicId) {
            await cloudinary.uploader.destroy(user.profilePicturePublicId).catch(() => {});
        }

        user.profilePicture = profilePicture;
        user.profilePicturePublicId = profilePicturePublicId;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile picture updated',
            user: await formatUserResponse(user),
        });
    } catch (error) {
        console.error('Error in updateProfilePicture', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to save profile picture',
        });
    }
};


const deleteProfilePicture = async (req, res) => {
    try {
        const user = await User.findById(req.userID);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        if (!user.profilePicture) {
            return res.status(400).json({
                success: false,
                message: 'No profile picture to delete',
            });
        }

        user.profilePicture = null;
        user.profilePicturePublicId = null;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile picture removed from your account',
            user: await formatUserResponse(user),
        });
    } catch (error) {
        console.error('Error in deleteProfilePicture', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete profile picture',
        });
    }
};

const updateProfile = async (req, res) => {
    try {
        const { name, email } = req.body;

        if (!name || !email) {
            return res.status(400).json({
                success: false,
                message: 'Name and email are required',
            });
        }

        const user = await User.findById(req.userID);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        if (email !== user.email) {
            const emailTaken = await User.findOne({ email });
            if (emailTaken) {
                return res.status(400).json({
                    success: false,
                    message: 'Email address is already in use',
                });
            }
            user.email = email;
        }

        user.name = name;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile details updated successfully',
            user: await formatUserResponse(user),
        });
    } catch (error) {
        console.error('Error in updateProfile', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update profile details',
        });
    }
};


module.exports = {
    signup,
    verifyEmail,
    resendVerificationEmail,
    login,
    logout,
    forgotPassword,
    verifyResetCode,
    resetPassword,
    checkAuth,
    updateProfilePicture,
    deleteProfilePicture,
    updateProfile,
}
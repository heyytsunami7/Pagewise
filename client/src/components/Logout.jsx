import React from 'react';
import { useAuthStore } from '../store/authStore';
import { useLocation, useNavigate } from 'react-router-dom';

const Logout = () => {
    const logout = useAuthStore((s) => s.logout);
    const location = useLocation();
    const navigate = useNavigate();

    const from = location.state?.from?.pathname || '/';

    const handleLogout = () => {
        logout()
            .then(() => {
                // Sign-out successful.
                alert('You are now Signed Out');
                navigate(from, { replace: true });
            })
            .catch((error) => {
                // An error happened.
                console.error('Logout error:', error);
            });
    };

    return (
        <div className="h-screen bg-teal-100 flex items-center justify-center">
            <button className="bg-red-700 px-8 py-2 text-white rounded" onClick={handleLogout}>
                Logout
            </button>
        </div>
    );
};

export default Logout;

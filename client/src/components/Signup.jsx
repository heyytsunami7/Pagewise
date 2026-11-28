import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import google from '../assets/google-logo.svg';

const Signup = () => {
  const signup = useAuthStore((s) => s.signup);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const [error, setError] = useState('');

  const location = useLocation();
  const navigate = useNavigate();

  const from = location.state?.from?.pathname || '/';

  const handleSignUp = async (event) => {
    event.preventDefault();
    const form = event.target;
    const email = form.email.value;
    const password = form.password.value;

    try {
      const userCredential = await signup(email, password);
      // signed up
      const user = userCredential.user;
      alert('Sign up Successfully !!');
      navigate(from, { replace: true });
    } catch (error) {
      const errorMessage = error.message;
      setError(errorMessage);
    }
  };

  const handleRegister = async () => {
    try {
      const result = await loginWithGoogle();
      const user = result.user;
      alert('Sign Up Successfully!!');
      navigate(from, { replace: true });
    } catch (error) {
      const errorMessage = error.message;
      setError(errorMessage);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <div className="relative py-3 sm:max-w-xl sm:mx-auto">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-300 to-blue-600 shadow-lg transform -skew-y-6 sm:skew-y-0 sm:-rotate-6 sm:rounded-3xl"></div>
        <div className="relative px-4 py-10 bg-white shadow-lg sm:rounded-3xl sm:p-20">
          <div className="max-w-md mx-auto">
            <div>
              <h1 className="text-2xl font-semibold">Sign Up Form</h1>
            </div>
            <div className="divide-y divide-gray-200">
              <form onSubmit={handleSignUp} className="py-8 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                <div className="relative">
                  <input id="email" name="email" type="text" className="peer h-10 w-full border-b-2 border-gray-300 text-gray-900 focus:outline-none focus:borer-rose-600" placeholder="Email address" />
                </div>
                <div className="relative">
                  <input id="password" name="password" type="password" className="peer h-10 w-full border-b-2 border-gray-300 text-gray-900 focus:outline-none focus:borer-rose-600" placeholder="Password" />
                </div>
                <p>If you have an account. Please <Link to="/login" className="text-blue-600 underline">Login </Link>   Here</p>
                <div className="relative">
                  <button className="bg-blue-500 text-white rounded-md px-6 py-2">Sign Up</button>
                </div>
              </form>
            </div>
          </div>
          <hr />
          <div className='flex w-full items-center flex-col mt-5 gap-3'>
            <button onClick={handleRegister}><img src={google} alt="" className='w-12 h-12 inline-block' />Login with Google</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signup;

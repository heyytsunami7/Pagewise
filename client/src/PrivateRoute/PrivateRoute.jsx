import React from 'react'
import { useAuthStore } from '../store/authStore'
import {useLocation , Navigate} from "react-router-dom"
import { Spinner } from "flowbite-react";

const PrivateRoute = ({children}) => {
    const user = useAuthStore((s) => s.user)
    const loading = useAuthStore((s) => s.loading)
    const location = useLocation();
    if (loading){
        return  <div className="text-center">
        <Spinner aria-label="Center-aligned spinner example" />
      </div>
    }
    if(user){
        return children;
    }
  return (
   <Navigate to="/login" state={{from: location}} replace></Navigate>
  )
}

export default PrivateRoute
import React from 'react'
import {useLoaderData,useParams} from "react-router-dom";
import { Button,  Label, TextInput, Textarea } from "flowbite-react";
import { useState } from 'react';
import { useAuthStore } from "../store/authStore";

const API = import.meta.env.VITE_API_URL;

const EditBooks = () => {
  const {id} = useParams();
  const {bookTitle,authorName,imageURL,category,bookDescription,bookPDFUrl} = useLoaderData();
  const getToken = useAuthStore((s) => s.getToken);

  const bookCategories = [
    "Fiction",
    "Non-Fiction",
    "Mystery",
    "Fantasy",
    "Horror",
    "Homour",
    "Biography",
    "Psychology",
    "History",
    "Buisness",
  ];
  const [selectedBookCategory, setSelectedBookCategory] = useState(
    bookCategories[0]
  );

  const handleChangeSelectedValue = (event) => {
    console.log(event.target.value);
    setSelectedBookCategory(event.target.value);
  };
  //handle book Submission
  const handleUpdate = (event)=>{
   event.preventDefault();
   const form = event.target;
   const bookTitle = form.bookTitle.value;
   const authorName = form.authorName.value;
   const imageURL = form.imageURL.value;
   const category = form.categoryName.value;
   const bookDescription = form.bookDescription.value;
   const bookPDFUrl = form.bookPDFUrl.value;
   const UpdateBookObj ={
     bookTitle,authorName,imageURL,category,bookDescription,bookPDFUrl 
    }
    //console.log(bookObj)
    //Update Book Data
    getToken().then(token => {
      fetch(`${API}/book/${id}`,{
        method: "PATCH",
        headers:{
          "Content-Type":"application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(UpdateBookObj)
      }).then(res=> res.json()).then(data =>{
        //console.log(data)
        alert("Book Updated Successfully !!")
      })
    })
  }

  
  return (
    <div className="px-4 my-12">
      <h2 className="mb-8 text-3xl font-bold">Update the Book Data</h2>
      <form onSubmit={handleUpdate} className="flex lg:w-[1180px] flex-col flex-wrap gap-4">
        {/* first row*/}
        <div className="flex gap-8">
          <div className="lg:w-1/2">
            <div className="mb-2 block">
              <Label htmlFor="bookTitle" value="Book Title" />
            </div>
            <TextInput
              id="bookTitle"
              name="bookTitle"
              placeholder="Book Name"
              required
              type="text"
              defaultValue={bookTitle}
            />
          </div>
          {/*authorName*/}
          <div className="lg:w-1/2">
            <div className="mb-2 block">
              <Label htmlFor="authorName" value="Author Name" />
            </div>
            <TextInput
              id="authorName"
              name="authorName"
              placeholder="Author Name"
              required
              type="text"
              defaultValue={authorName}
            />
          </div>
        </div>
        {/* second row*/}
        <div className="flex gap-8">
          <div className="lg:w-1/2">
            <div className="mb-2 block">
              <Label htmlFor="imageURL" value="Book Image URL" />
            </div>
            <TextInput
              id="imageURL"
              name="imageURL"
              placeholder="Book Image URL"
              required
              type="text"
              defaultValue={imageURL}
            />
          </div>
          {/*category*/}
          <div className="lg:w-1/2">
            <div className="mb-2 block">
              <Label htmlFor="inputState" value="Book Category" />
            </div>
            <select
              id="inputState"
              name="categoryName"
              className="w-full rounded"
              value={selectedBookCategory}
              onChange={handleChangeSelectedValue}
            >
              {bookCategories.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        {/* bookDescription */}
        <div>
          <div className="mb-2 block">
            <Label htmlFor="bookDescription" value="Book Description" />
          </div>
          <Textarea
            id="bookDescription"
            name="bookDescription"
            placeholder="Book Description..."
            required
            className="w-full"
            rows={5}
            defaultValue={bookDescription}
          />
        </div>
        {/*book pdf link*/}
        <div>
          <div className="mb-2 block">
            <Label htmlFor="bookPDFUrl" value="Book PDF URL" />
          </div>
          <TextInput
            id="bookPDFUrl"
            name="bookPDFUrl"
            type="text"
            placeholder="URL"
            required
            defaultValue={bookPDFUrl}
          />
        </div>
        <Button type="submit" className="mt-5 bg-teal-600 justify-center">Update Book Details</Button>
      </form>
    </div>
  );
}

export default EditBooks
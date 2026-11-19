from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


Category = Literal["Tacones", "Botas", "Casuales"]
ProductStatus = Literal["draft", "published", "archived"]


class Credentials(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    category: Category
    color: str = Field(min_length=1, max_length=50)
    price_bs: int = Field(gt=0, le=100000)
    description: str = Field(default="", max_length=1000)
    image_url: HttpUrl | None = None
    status: Literal["draft", "published"] = "draft"

    @field_validator("name", "color", "description")
    @classmethod
    def normalize(cls, value: str) -> str:
        clean = value.strip()
        if not clean and value != "":
            raise ValueError("No se permiten valores solo con espacios.")
        return clean


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    category: Category | None = None
    color: str | None = Field(default=None, min_length=1, max_length=50)
    price_bs: int | None = Field(default=None, gt=0, le=100000)
    description: str | None = Field(default=None, max_length=1000)
    image_url: HttpUrl | None = None
    status: ProductStatus | None = None


class CustomerCreate(BaseModel):
    alias: str = Field(min_length=3, max_length=60)
    preference: Literal["Tacones", "Botas", "Casuales", "Sin definir"] = "Sin definir"


class CustomerUpdate(BaseModel):
    preference: Literal["Tacones", "Botas", "Casuales", "Sin definir"] | None = None
    followup: Literal["Pendiente", "Contactado", "Sin pendiente"] | None = None
    note: str | None = Field(default=None, max_length=240)
    next_contact: date | None = None


class SaleCreate(BaseModel):
    product_id: str
    customer_id: str | None = None
    quantity: int = Field(ge=1, le=100)
    sold_at: date

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


Category = Literal["Tacones", "Botas", "Casuales"]
ProductStatus = Literal["draft", "published", "archived"]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Credentials(Payload):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


class ProductCreate(Payload):
    name: str = Field(min_length=2, max_length=100)
    category: Category
    color: str = Field(min_length=1, max_length=50)
    price_bs: int = Field(gt=0, le=100000, strict=True)
    description: str = Field(default="", max_length=1000)
    image_url: HttpUrl | None = None
    status: Literal["draft", "published"] = "draft"

class ProductUpdate(Payload):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    category: Category | None = None
    color: str | None = Field(default=None, min_length=1, max_length=50)
    price_bs: int | None = Field(default=None, gt=0, le=100000, strict=True)
    description: str | None = Field(default=None, max_length=1000)
    image_url: HttpUrl | None = None
    status: ProductStatus | None = None


class CustomerCreate(Payload):
    alias: str = Field(min_length=3, max_length=60)
    preference: Literal["Tacones", "Botas", "Casuales", "Sin definir"] = "Sin definir"


class CustomerUpdate(Payload):
    preference: Literal["Tacones", "Botas", "Casuales", "Sin definir"] | None = None
    followup: Literal["Pendiente", "Contactado", "Sin pendiente"] | None = None
    note: str | None = Field(default=None, max_length=240)
    next_contact: date | None = None

    @model_validator(mode="after")
    def required_values(self):
        if any(getattr(self, key) is None for key in self.model_fields_set - {"next_contact"}):
            raise ValueError("No se pueden vaciar los campos obligatorios.")
        return self


class SaleCreate(Payload):
    product_id: str = Field(min_length=1, max_length=64)
    customer_id: str | None = Field(default=None, min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=100, strict=True)
    sold_at: date
